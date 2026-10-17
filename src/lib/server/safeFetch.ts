import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** True for loopback, private, link-local, CGNAT, multicast, unspecified and IPv6 ULA/mapped forms. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("ff")) return true; // multicast
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const n1 = parseInt(hexMapped[1], 16);
      const n2 = parseInt(hexMapped[2], 16);
      return isPrivateAddress(`${n1 >> 8}.${n1 & 255}.${n2 >> 8}.${n2 & 255}`);
    }
    return false;
  }
  return true;
}

export class UnsafeUrlError extends Error {}

/** Reject non-http(s) URLs and hosts that resolve to a private address. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That does not look like a link.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new UnsafeUrlError("Only http(s) links can be read.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new UnsafeUrlError("Only public links can be read.");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError("Only public links can be read.");
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError("That host could not be found.");
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError("Only public links can be read.");
  return u;
}

const MAX_BYTES = 10 * 1024 * 1024;

/** Fetch with manual redirects (each hop re-validated) and a byte cap on the body. */
export async function fetchPublic(raw: string, init: { timeoutMs?: number; accept?: string } = {}): Promise<{ res: Response; body: Uint8Array; finalUrl: string }> {
  let url = (await assertPublicUrl(raw)).toString();
  const signal = AbortSignal.timeout(init.timeoutMs ?? 20000);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; UnderstandReader/0.1)", accept: init.accept ?? "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8" },
      redirect: "manual",
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new UnsafeUrlError("That page redirected nowhere.");
      url = (await assertPublicUrl(new URL(loc, url).toString())).toString();
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
}
