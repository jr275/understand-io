// The shared counter makes a rate limit hold across instances. The first block replaces it with a counter that two "instances" (two
// fresh process memories) both count into; the second talks to the real local PostgreSQL (DATABASE_URL), like accountMerge.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { limitImports, limitServerKey, resetRateLimits, setSharedCounter } from "@/lib/server/rateLimit";
import { SHARED_TIMEOUT_MS, databaseCounter, hashKey, type SharedCounter } from "@/lib/server/rateStore";

const req = (ip: string) => new Request("http://localhost/api/import/text", { method: "POST", headers: { "x-forwarded-for": ip } });

/** A counter in a Map: what the database does, without one. */
function memoryCounter(): SharedCounter & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  return {
    rows,
    async hit(key, windowMs, now) {
      const start = Math.floor(now / windowMs) * windowMs;
      const k = `${key}@${start}`;
      const count = (rows.get(k) ?? 0) + 1;
      rows.set(k, count);
      return { count, resetMs: start + windowMs - now };
    },
  };
}

describe("the shared layer of the rate limit", () => {
  const saved = process.env.GLOSS_RATE_IMPORT;
  beforeEach(() => {
    resetRateLimits();
    process.env.GLOSS_RATE_IMPORT = "3";
  });
  afterEach(() => {
    setSharedCounter(undefined);
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (saved === undefined) delete process.env.GLOSS_RATE_IMPORT;
    else process.env.GLOSS_RATE_IMPORT = saved;
  });

  it("without it, every instance grants the full budget (the limit is per instance)", async () => {
    setSharedCounter(null);
    for (let instance = 0; instance < 3; instance++) {
      resetRateLimits(); // a different process's memory
      for (let i = 0; i < 3; i++) expect(await limitImports(req("203.0.113.40"))).toBeNull();
    }
  });

  it("with it, the budget is one for all instances: the fourth import is refused whichever instance it reaches", async () => {
    setSharedCounter(memoryCounter());
    const answers: (number | null)[] = [];
    for (let i = 0; i < 5; i++) {
      resetRateLimits(); // each request lands on a fresh instance
      answers.push((await limitImports(req("203.0.113.41")))?.status ?? null);
    }
    expect(answers).toEqual([null, null, null, 429, 429]);
  });

  it("the refusal says when to come back, from the shared window", async () => {
    setSharedCounter(memoryCounter());
    for (let i = 0; i < 3; i++) await limitImports(req("203.0.113.42"));
    const blocked = await limitImports(req("203.0.113.42"));
    expect(blocked?.status).toBe(429);
    const wait = Number(blocked?.headers.get("retry-after"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(600);
    expect(blocked?.headers.get("cache-control")).toBe("no-store");
  });

  it("counts each client separately, and the server key buckets separately from imports", async () => {
    const counter = memoryCounter();
    setSharedCounter(counter);
    process.env.GLOSS_RATE_GLOSS = "2";
    try {
      for (let i = 0; i < 3; i++) await limitImports(req("203.0.113.43"));
      expect((await limitImports(req("203.0.113.43")))?.status).toBe(429);
      expect(await limitImports(req("203.0.113.44"))).toBeNull();
      resetRateLimits();
      expect(await limitServerKey(req("203.0.113.43"), "gloss")).toBeNull(); // another bucket for the same client
      expect(await limitServerKey(req("203.0.113.43"), "gloss")).toBeNull();
      expect((await limitServerKey(req("203.0.113.43"), "gloss"))?.status).toBe(429);
    } finally {
      delete process.env.GLOSS_RATE_GLOSS;
    }
  });

  it("when the shared counter fails, the request is judged by this instance's own count and the failure is logged without the client", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setSharedCounter({
      hit: async () => {
        throw new Error('relation "rate_hits" does not exist');
      },
    });
    const answers: (number | null)[] = [];
    for (let i = 0; i < 5; i++) answers.push((await limitImports(req("203.0.113.45")))?.status ?? null);
    expect(answers).toEqual([null, null, null, 429, 429]); // still limited, per instance
    expect(warn).toHaveBeenCalledTimes(1); // once a minute, not once a request
    expect(String(warn.mock.calls[0][0])).not.toMatch(/203\.0\.113|rate_hits/);
  });

  it("when the shared counter does not answer in time, the request goes on instead of waiting for it", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setSharedCounter({ hit: () => new Promise(() => {}) });
    let done = false;
    const pending = limitImports(req("203.0.113.46")).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(SHARED_TIMEOUT_MS - 100);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toBeNull();
  });
});

const db = process.env.DATABASE_URL ? getDb() : null;

describe.skipIf(!db)("the database counter (real PostgreSQL)", () => {
  const unique = () => `test:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  it("counts concurrent hits exactly: twenty at once give the counts 1 to 20, none twice", async () => {
    const key = unique();
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 20 }, () => databaseCounter.hit(key, 600_000, now)));
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("starts a new count in the next window and reports the time left in this one", async () => {
    const key = unique();
    const windowMs = 60_000;
    const start = Math.floor(Date.now() / windowMs) * windowMs;
    const a = await databaseCounter.hit(key, windowMs, start + 10_000);
    expect(a).toEqual({ count: 1, resetMs: 50_000 });
    expect((await databaseCounter.hit(key, windowMs, start + 20_000)).count).toBe(2);
    expect((await databaseCounter.hit(key, windowMs, start + windowMs + 5)).count).toBe(1);
  });

  it("stores a hash of the key, never the client address", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const key = `probe:ip:${ip}:${unique()}`;
    await databaseCounter.hit(key, 600_000, Date.now());
    const rows = await db!.execute<{ key: string }>(sql`SELECT key FROM rate_hits WHERE key = ${hashKey(key)}`);
    expect(rows.length).toBe(1);
    const leaked = await db!.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM rate_hits WHERE key LIKE ${"%" + ip + "%"}`);
    expect(leaked[0].n).toBe(0);
  });

  it("limits imports across instances through the real table", async () => {
    process.env.GLOSS_RATE_IMPORT = "2";
    // Each run is a client of its own, or its counts would carry over from a run inside the same window.
    const client = unique();
    const mk = () => req(client);
    try {
      const answers: (number | null)[] = [];
      for (let i = 0; i < 4; i++) {
        resetRateLimits(); // another instance each time
        answers.push((await limitImports(mk()))?.status ?? null);
      }
      expect(answers.slice(0, 2)).toEqual([null, null]);
      expect(answers.slice(2)).toEqual([429, 429]);
    } finally {
      delete process.env.GLOSS_RATE_IMPORT;
    }
  });
});
