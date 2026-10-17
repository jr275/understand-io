import dns from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/* ------------------------------------------------------------------ address classification */

const V4_BLOCKED = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT (also Alibaba metadata 100.100.100.200)
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast (deprecated)
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const)
  V4_BLOCKED.addSubnet(net, bits, "ipv4");

/** Parse any textual IPv6 address (zone id and dotted-quad tail included) into 16 bytes, or null. */
function parseIPv6(input: string): Uint8Array | null {
  let ip = input.split("%")[0];
  const dotted = ip.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const o = dotted.slice(2).map(Number);
    if (o.some((n) => n > 255)) return null;
    ip = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    const n = parseInt(g, 16);
    bytes[i * 2] = n >> 8;
    bytes[i * 2 + 1] = n & 255;
  });
  return bytes;
}

function inPrefix(bytes: Uint8Array, prefix: Uint8Array, bits: number) {
  for (let i = 0; i < bits; i += 8) {
    const mask = bits - i >= 8 ? 0xff : (0xff << (8 - (bits - i))) & 0xff;
    if ((bytes[i / 8] & mask) !== (prefix[i / 8] & mask)) return false;
  }
  return true;
}

const V6 = (s: string, bits: number) => ({ prefix: parseIPv6(s)!, bits });
const V6_BLOCKED = [
  V6("::", 96), // unspecified, loopback and the deprecated IPv4-compatible range
  V6("100::", 64), // discard-only
  V6("2001::", 32), // Teredo
  V6("2001:db8::", 32), // documentation
  V6("3fff::", 20), // documentation
  V6("64:ff9b:1::", 48), // local-use NAT64
  V6("fc00::", 7), // unique local
  V6("fe80::", 10), // link-local
  V6("fec0::", 10), // deprecated site-local
  V6("ff00::", 8), // multicast
];
/** Ranges that carry an IPv4 address: [prefix, bits, first byte of the embedded address]. */
const V6_EMBEDDED = [
  { ...V6("::ffff:0:0", 96), at: 12 }, // IPv4-mapped
  { ...V6("::ffff:0:0:0", 96), at: 12 }, // SIIT
  { ...V6("64:ff9b::", 96), at: 12 }, // NAT64
  { ...V6("2002::", 16), at: 2 }, // 6to4
];

/** True for loopback, private, link-local, CGNAT, reserved, documentation, multicast and unspecified addresses, including IPv4 carried inside IPv6. Anything that is not an address counts as private (fail closed). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return V4_BLOCKED.check(ip, "ipv4");
  if (v === 6) {
    const b = parseIPv6(ip);
    if (!b) return true;
    if (V6_BLOCKED.some((r) => inPrefix(b, r.prefix, r.bits))) return true;
    for (const r of V6_EMBEDDED) if (inPrefix(b, r.prefix, r.bits)) return isPrivateAddress(`${b[r.at]}.${b[r.at + 1]}.${b[r.at + 2]}.${b[r.at + 3]}`);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ pinned connections */

export class UnsafeUrlError extends Error {}

/** Raised from the socket's DNS lookup when any resolved address is not public. */
export class BlockedAddressError extends Error {
  code = "EBLOCKEDADDRESS";
}

/** dns.lookup in `all` mode, or a stand-in with the same shape (tests inject one). */
export type Resolver = (hostname: string, options: dns.LookupOptions, callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => void;

const systemResolver: Resolver = (hostname, options, callback) => dns.lookup(hostname, { ...options, all: true }, callback as never);

/**
 * The lookup the HTTP connection itself uses. Validation and connection share this single resolution, so a
 * name that answers "public" to a pre-check and "private" to the connect (DNS rebinding) cannot reach the
 * private address: the socket is only ever opened to an address this function has just approved.
 */
export function safeLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, options, (err, addrs) => {
      const done = callback as (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;
      if (err) return done(err);
      if (!addrs?.length || addrs.some((a) => isPrivateAddress(a.address))) return done(new BlockedAddressError("blocked address"));
      if (options.all) return done(null, addrs);
      done(null, addrs[0].address, addrs[0].family);
    });
  };
}

let sharedAgent: Agent | undefined;
function defaultAgent() {
  return (sharedAgent ??= new Agent({ connect: { lookup: safeLookup() } }));
}

function isBlockedAddressError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  if (err instanceof BlockedAddressError) return true;
  const e = err as { cause?: unknown; errors?: unknown[] };
  return isBlockedAddressError(e.cause, depth + 1) || (Array.isArray(e.errors) && e.errors.some((x) => isBlockedAddressError(x, depth + 1)));
}

/* ------------------------------------------------------------------ URL policy */

const ALLOWED_PORTS = new Set(["", "80", "443"]); // `new URL` drops a scheme's default port, so "" means 80/443

/** Reject non-http(s) URLs, non-web ports, and hosts that resolve to a private address. */
export async function assertPublicUrl(raw: string, resolve: Resolver = systemResolver): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That does not look like a link.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new UnsafeUrlError("Only http(s) links can be read.");
  if (!ALLOWED_PORTS.has(u.port)) throw new UnsafeUrlError("Only links on the standard web ports (80 and 443) can be read.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new UnsafeUrlError("Only public links can be read.");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError("Only public links can be read.");
    return u;
  }
  let addrs: dns.LookupAddress[];
  try {
    addrs = await new Promise((ok, fail) => resolve(host, {}, (err, a) => (err ? fail(err) : ok(a))));
  } catch {
    throw new UnsafeUrlError("That host could not be found.");
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError("Only public links can be read.");
  return u;
}

const MAX_BYTES = 10 * 1024 * 1024;
export const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

/**
 * Fetch with manual redirects (each hop re-validated), connections pinned to validated addresses, and a
 * byte cap on the body. `resolver` replaces system DNS (a test seam).
 */
export async function fetchPublic(raw: string, init: { timeoutMs?: number; accept?: string; resolver?: Resolver } = {}): Promise<{ res: Awaited<ReturnType<typeof undiciFetch>>; body: Uint8Array; finalUrl: string }> {
  let url = (await assertPublicUrl(raw, init.resolver)).toString();
  const signal = AbortSignal.timeout(init.timeoutMs ?? 20000);
  const agent = init.resolver ? new Agent({ connect: { lookup: safeLookup(init.resolver) } }) : defaultAgent();
  try {
    for (let hop = 0; hop < 5; hop++) {
      let res: Awaited<ReturnType<typeof undiciFetch>>;
      try {
        res = await undiciFetch(url, {
          headers: {
            // A browser-like agent: many publishers answer 403 to anything that announces itself as a bot.
            "user-agent": BROWSER_UA,
            accept: init.accept ?? "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9,pt-BR;q=0.8",
          },
          redirect: "manual",
          signal,
          dispatcher: agent,
        });
      } catch (err) {
        if (isBlockedAddressError(err)) throw new UnsafeUrlError("Only public links can be read.");
        throw err;
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) throw new UnsafeUrlError("That page redirected nowhere.");
        url = (await assertPublicUrl(new URL(loc, url).toString(), init.resolver)).toString();
        continue;
      }
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_BYTES) throw new UnsafeUrlError("That page is larger than 10 MB.");
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BYTES) {
            await reader.cancel();
            throw new UnsafeUrlError("That page is larger than 10 MB.");
          }
          chunks.push(value);
        }
      }
      const body = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) {
        body.set(c, o);
        o += c.byteLength;
      }
      return { res, body, finalUrl: url };
    }
    throw new UnsafeUrlError("Too many redirects.");
  } finally {
    if (init.resolver) await agent.close().catch(() => {});
  }
}
