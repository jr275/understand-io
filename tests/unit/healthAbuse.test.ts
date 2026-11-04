// READINESS (GET /api/health/ready) under abuse: who may ask, what a query string can and cannot do, how many readings can ever be made, and how long
// one may take. "Readings" are counted on the store's ping: one ping is one wake-up of the database.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createMemoryAiStore, setAiStore, type AiStore } from "@/lib/server/aiStore";
import { forgetHealthCache } from "@/lib/server/healthProbe";
import { readiness, resetHealthLimits } from "@/lib/server/readiness";

const TOKEN = "k".repeat(40);
const T0 = Date.UTC(2026, 10, 3, 12);
let ping: Mock<() => Promise<void>>;
let usage: Mock<(now: number) => ReturnType<AiStore["usage"]>>;
let base: AiStore;
let pings = 0;

const install = (p: () => Promise<void>) => {
  ping = vi.fn(p);
  setAiStore({ ...base, ping, usage });
};
beforeEach(() => {
  forgetHealthCache();
  resetHealthLimits();
  pings = 0;
  base = createMemoryAiStore();
  usage = vi.fn((now: number) => base.usage(now));
  install(async () => {});
  vi.stubEnv("DATABASE_URL", "postgres://placeholder/never-connected");
  vi.stubEnv("GLOSS_HEALTH_TOKEN", TOKEN);
});
afterEach(() => {
  setAiStore(undefined);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const rq = (qs = "", headers: Record<string, string> = {}, ip = "198.51.100.1") => new Request(`http://x.test/api/health/ready${qs}`, { headers: { "x-forwarded-for": ip, ...headers } });
const authed = (qs = "", ip?: string, headers: Record<string, string> = {}) => rq(qs, { authorization: `Bearer ${TOKEN}`, ...headers }, ip);

describe("who may ask", () => {
  it("does not exist (404) unless a token of 32 or more characters is configured, and does no database work either way", async () => {
    vi.stubEnv("GLOSS_HEALTH_TOKEN", "");
    expect((await readiness(authed(), T0)).status).toBe(404);
    vi.stubEnv("GLOSS_HEALTH_TOKEN", "k".repeat(31));
    expect((await readiness(rq("", { authorization: `Bearer ${"k".repeat(31)}` }), T0)).status).toBe(404);
    vi.stubEnv("GLOSS_HEALTH_TOKEN", "k".repeat(32));
    expect((await readiness(rq("", { authorization: `Bearer ${"k".repeat(32)}` }), T0)).status).toBe(200);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("answers 401 to a missing, wrong or malformed token without any database work", async () => {
    const bad: Record<string, string>[] = [{}, { authorization: "Bearer " }, { authorization: "Bearer nope" }, { authorization: `bearer ${TOKEN}` }, { authorization: `Basic ${TOKEN}` }, { authorization: TOKEN }, { authorization: `Bearer ${TOKEN}x` }, { authorization: `Bearer ${TOKEN.slice(1)}` }];
    for (const h of bad) expect((await readiness(rq("?fresh=1&strict=1", h), T0)).status, JSON.stringify(h)).toBe(401);
    expect(ping).not.toHaveBeenCalled();
    expect(usage).not.toHaveBeenCalled();
  });

  it("a token in the query string is not a token", async () => {
    expect((await readiness(rq(`?token=${TOKEN}&access_token=${TOKEN}&key=${TOKEN}`), T0)).status).toBe(401);
    expect(ping).not.toHaveBeenCalled();
  });

  it("guessing is limited per address: thirty attempts, then 429 even for the right token, and other addresses are unaffected", async () => {
    const guesses: number[] = [];
    for (let i = 0; i < 40; i++) guesses.push((await readiness(rq("", { authorization: `Bearer guess-${i}` }, "203.0.113.9"), T0 + i)).status);
    expect(guesses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(guesses.slice(30).every((s) => s === 429)).toBe(true);
    const locked = await readiness(authed("", "203.0.113.9"), T0 + 100);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await readiness(authed("", "203.0.113.10"), T0 + 100)).status).toBe(200);
    expect((await readiness(authed("", "203.0.113.9"), T0 + 61_000)).status).toBe(200);
    expect(ping).toHaveBeenCalledTimes(1); // the allowed calls share one reading, the refused ones cost nothing
  });

  it("never echoes the token, in the answer or the log", async () => {
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const texts = [await (await readiness(authed(), T0)).text(), await (await readiness(rq("", { authorization: `Bearer ${TOKEN}x` }), T0)).text()];
    expect(texts.join(" ")).not.toContain(TOKEN);
    expect(JSON.stringify([...logs.mock.calls, ...err.mock.calls])).not.toContain(TOKEN);
    logs.mockRestore();
    err.mockRestore();
  });
});

describe("a query string cannot buy a reading", () => {
  const noise = ["?fresh=1&fresh=0", "?fresh=true", "?fresh=2", "?fresh=", "?FRESH=1", "?Fresh=1", "?fresh[]=1", "?fresh=1%20", "?fresh=%31%20", "?fresh%5B%5D=1", "?fresh=1&fresh=1", "?x=1&fresh", "?;fresh=1"];

  it("without the token: no reading, for every spelling", async () => {
    for (const qs of ["?fresh=1", "?strict=1&fresh=1", ...noise]) expect((await readiness(rq(qs), T0)).status, qs).toBe(401);
    expect(ping).not.toHaveBeenCalled();
  });

  it("with the token, anything but exactly one fresh=1 reuses the healthy reading", async () => {
    await readiness(authed(), T0);
    expect(ping).toHaveBeenCalledTimes(1);
    for (const qs of noise) {
      const j = await (await readiness(authed(qs), T0 + 3_600_000 / 100)).json(); // 36 seconds later: past the floor, well inside the 15 minutes
      expect(j.checked.cached, qs).toBe(true);
    }
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("request headers that ask for a bypass are not honoured", async () => {
    await readiness(authed(), T0);
    for (const h of ([{ "cache-control": "no-cache" }, { "cache-control": "max-age=0" }, { pragma: "no-cache" }, { "x-fresh": "1" }, { "x-vercel-cache": "BYPASS" }] as Record<string, string>[])) {
      expect((await (await readiness(authed("", undefined, h), T0 + 60_000)).json()).checked.cached, JSON.stringify(h)).toBe(true);
    }
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("a single fresh=1 does ask for a new reading, once the floor has passed", async () => {
    await readiness(authed(), T0);
    await readiness(authed("?fresh=1"), T0 + 11_000);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("strict only changes the status code of what was read; it never makes another reading", async () => {
    await readiness(authed(), T0);
    await readiness(authed("?strict=1"), T0 + 60_000);
    await readiness(authed("?strict=1&strict=1"), T0 + 120_000);
    expect(ping).toHaveBeenCalledTimes(1);
  });
});

describe("how many readings can be made", () => {
  it("fifty concurrent callers share one reading", async () => {
    install(() => new Promise((r) => setTimeout(r, 40)));
    const answers = await Promise.all(Array.from({ length: 50 }, (_, i) => readiness(authed("?fresh=1", `192.0.2.${i}`), T0)));
    expect(answers.every((r) => r.status === 200)).toBe(true);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("a hammered ?fresh=1 makes one reading per floor, not one per call", async () => {
    for (let i = 0; i < 200; i++) await readiness(authed("?fresh=1", `192.0.2.${i % 200}`), T0 + i * 40); // 200 calls over 8 seconds
    expect(ping).toHaveBeenCalledTimes(1);
    await readiness(authed("?fresh=1", "192.0.2.250"), T0 + 9_999);
    expect(ping).toHaveBeenCalledTimes(1);
    await readiness(authed("?fresh=1", "192.0.2.250"), T0 + 10_000);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("the floor is configurable, and 0 means every call is real (as the tests of the readings themselves need)", async () => {
    vi.stubEnv("GLOSS_HEALTH_MIN_PROBE_SECONDS", "0");
    for (let i = 0; i < 5; i++) await readiness(authed("?fresh=1", "192.0.2.1"), T0 + i);
    expect(ping).toHaveBeenCalledTimes(5);
  });

  it("a down database is read twice (one retry) per floor and no more, however hard it is hit, and recovery is seen at the next floor", async () => {
    let up = false;
    install(async () => {
      pings++;
      if (!up) throw new Error("down");
    });
    for (let i = 0; i < 100; i++) expect((await readiness(authed("?fresh=1", `192.0.2.${i}`), T0 + i)).status).toBe(503);
    expect(pings).toBe(2);
    up = true;
    expect((await readiness(authed("?fresh=1", "192.0.2.201"), T0 + 9_000)).status).toBe(503); // still inside the floor: the failure is what is known
    expect(pings).toBe(2);
    const back = await readiness(authed("?fresh=1", "192.0.2.202"), T0 + 10_000);
    expect(back.status).toBe(200);
    expect(pings).toBe(3);
  });

  it("a reading in flight is not duplicated by callers who arrive during it, even after the floor", async () => {
    install(() => new Promise((r) => setTimeout(r, 60)));
    const first = readiness(authed("?fresh=1", "192.0.2.1"), T0);
    await new Promise((r) => setTimeout(r, 10));
    const second = readiness(authed("?fresh=1", "192.0.2.2"), T0 + 20_000);
    await Promise.all([first, second]);
    expect(ping).toHaveBeenCalledTimes(1);
  });
});

describe("how long a reading may take", () => {
  it("a database that hangs is called down within the ceiling, and the slow wake-up of a sleeping compute is still allowed one retry", async () => {
    vi.useFakeTimers();
    install(() => new Promise(() => {}));
    const pending = readiness(authed("?fresh=1"), T0);
    await vi.advanceTimersByTimeAsync(6_100); // two attempts of 3 seconds
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "down", database: "down" });
  });

  it("a database that answers each step just inside its limit still cannot hold a reading beyond 8 seconds", async () => {
    vi.useFakeTimers();
    install(() => new Promise((r) => setTimeout(r, 2_900)));
    usage = vi.fn(() => new Promise<never>(() => {})) as typeof usage; // ping answers slowly, the ledger never does
    setAiStore({ ...base, ping, usage });
    const t0 = Date.now();
    const pending = readiness(authed("?fresh=1"), T0);
    await vi.advanceTimersByTimeAsync(8_100);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(Date.now() - t0).toBeLessThanOrEqual(8_100); // without the ceiling this is 11.8 seconds (two attempts of 2.9 + 3)
  });
});
