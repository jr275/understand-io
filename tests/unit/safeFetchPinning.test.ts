// SEC-3: the address that was validated is the address that is connected to, and only web ports are reachable.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type dns from "node:dns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UnsafeUrlError, assertPublicUrl, fetchPublic, safeLookup, type Resolver } from "@/lib/server/safeFetch";

const answers = (...addrs: string[]): Resolver => (_host, _opts, cb) => cb(null, addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));

/** Drives a lookup function the way net.connect does and returns what it called back with. */
function run(lookup: ReturnType<typeof safeLookup>, all: boolean) {
  return new Promise<{ err: NodeJS.ErrnoException | null; address?: string | dns.LookupAddress[]; family?: number }>((resolve) => {
    (lookup as unknown as (h: string, o: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void) => void)("example.test", { all }, (err, address, family) => resolve({ err, address, family }));
  });
}

describe("safeLookup (the lookup the socket itself uses)", () => {
  it("refuses a name when any answer is private, in both lookup modes", async () => {
    for (const lookup of [safeLookup(answers("127.0.0.1")), safeLookup(answers("93.184.216.34", "10.0.0.5")), safeLookup(answers("::1")), safeLookup(answers("64:ff9b::7f00:1")), safeLookup(answers("169.254.169.254"))]) {
      for (const all of [true, false]) {
        const r = await run(lookup, all);
        expect(r.err?.message).toBe("blocked address");
        expect(r.address).toBeUndefined();
      }
    }
  });
  it("refuses an empty answer and passes resolver errors through", async () => {
    expect((await run(safeLookup(answers()), true)).err).toBeTruthy();
    const failing: Resolver = (_h, _o, cb) => cb(Object.assign(new Error("nope"), { code: "ENOTFOUND" }), []);
    expect((await run(safeLookup(failing), false)).err?.code).toBe("ENOTFOUND");
  });
  it("hands public answers back in the shape net.connect asked for", async () => {
    const lookup = safeLookup(answers("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"));
    expect(await run(lookup, true)).toMatchObject({ err: null, address: [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }] });
    expect(await run(lookup, false)).toMatchObject({ err: null, address: "93.184.216.34", family: 4 });
  });
});

describe("DNS rebinding", () => {
  it("a name that is public for the pre-check but private when the socket resolves it is never connected to", async () => {
    let calls = 0;
    const rebinding: Resolver = (_h, _o, cb) => {
      calls++;
      const address = calls === 1 ? "93.184.216.34" : "127.0.0.1"; // first answer: public; every later answer: loopback
      cb(null, [{ address, family: 4 }]);
    };
    // Port 80 on loopback has no listener here: had the socket been opened we would see ECONNREFUSED (a TypeError), not our own refusal.
    const err = await fetchPublic("http://rebind.test/", { resolver: rebinding, timeoutMs: 3000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsafeUrlError);
    expect((err as Error).message).toBe("Only public links can be read.");
    expect(calls).toBeGreaterThanOrEqual(2); // pre-check and connect-time lookup are separate resolutions, both validated
  });
});

describe("port policy", () => {
  let server: Server;
  let port = 0;
  let hits = 0;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits++;
      res.end("<html></html>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("only 80 and 443 (explicit or default) are reachable", async () => {
    const pub = answers("93.184.216.34");
    for (const p of [22, 25, 3306, 5432, 6379, 8080, 8443, 9200, 3000, 65535]) await expect(assertPublicUrl(`http://example.test:${p}/`, pub), String(p)).rejects.toThrow(/standard web ports/);
    for (const u of ["http://example.test/", "https://example.test/", "http://example.test:80/", "https://example.test:443/", "http://example.test:443/", "https://example.test:80/"]) expect((await assertPublicUrl(u, pub)).hostname).toBe("example.test");
  });
  it("a real local server is never contacted, by literal address or by a name pointing at it", async () => {
    await expect(fetchPublic(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(fetchPublic(`http://[::ffff:127.0.0.1]:${port}/`)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(fetchPublic(`http://points-at-loopback.test:${port}/`, { resolver: answers("127.0.0.1") })).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(fetchPublic(`http://points-at-loopback.test/`, { resolver: answers("127.0.0.1") })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(hits).toBe(0);
  });
});
