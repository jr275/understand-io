// The allowance store against the real local PostgreSQL (DATABASE_URL), like accountMerge.test.ts: what must hold when many requests,
// possibly on different instances, arrive at the same moment. Every key is unique to a run, and the ledger is read by a period no other test uses.
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { databaseAiStore as store } from "@/lib/server/aiStore";
import { hashKey } from "@/lib/server/rateStore";

const db = process.env.DATABASE_URL ? getDb() : null;
const run = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const key = (s: string) => `${run}:${s}`;
const DAY = 86_400_000;
/** A moment far from today, so these tests' ledger rows never meet a real day's. Each test gets its own month. */
let month = 0;
const nextMonth = () => Date.UTC(2031, month++ % 12, 15, 12, 0, 0);

describe.skipIf(!db)("the allowance store (real PostgreSQL)", () => {
  afterAll(async () => {
    await db!.execute(sql`DELETE FROM ai_ledger WHERE period LIKE '2031-%'`);
    await db!.execute(sql`DELETE FROM ai_reservations WHERE expires_at > 0 AND id LIKE ${run + "%"}`);
  });

  it("counts a day's questions exactly even when twenty arrive at once, and gives one back", async () => {
    const now = nextMonth();
    const k = key("quota");
    const counts = await Promise.all(Array.from({ length: 20 }, () => store.quotaHit(k, DAY, now)));
    expect(counts.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    await store.quotaRefund(k, DAY, now);
    expect(await store.quotaHit(k, DAY, now)).toBe(20);
    expect(await store.quotaHit(k, DAY, now + DAY)).toBe(1); // the next UTC day starts again
  });

  it("never lets a refund take a count below zero", async () => {
    const now = nextMonth();
    const k = key("floor");
    await store.quotaRefund(k, DAY, now);
    expect(await store.quotaHit(k, DAY, now)).toBe(1);
  });

  it("gives one generation at a time: of twenty simultaneous attempts on one key exactly one wins", async () => {
    const now = nextMonth();
    const k = key("lease");
    const wins = await Promise.all(Array.from({ length: 20 }, (_, i) => store.acquireLease(k, `tok${i}`, 60_000, now)));
    expect(wins.filter(Boolean)).toHaveLength(1);
  });

  it("frees the lease on release by its holder only, and when it expires", async () => {
    const now = nextMonth();
    const k = key("lease2");
    expect(await store.acquireLease(k, "holder", 60_000, now)).toBe(true);
    await store.releaseLease(k, "someone-else");
    expect(await store.acquireLease(k, "intruder", 60_000, now + 1000)).toBe(false); // a stranger's release changed nothing
    await store.releaseLease(k, "holder");
    expect(await store.acquireLease(k, "next", 60_000, now + 2000)).toBe(true);
    expect(await store.acquireLease(k, "late", 60_000, now + 30_000)).toBe(false);
    expect(await store.acquireLease(k, "after-expiry", 60_000, now + 62_001)).toBe(true); // "next" never released: it ran out
  });

  it("keeps only a hash of who holds a lease or a count, never the reader id or the address", async () => {
    const now = nextMonth();
    const who = `${run}:reader:r_secretreaderid:ip:203.0.113.77`;
    await store.acquireLease(who, "t", 60_000, now);
    await store.quotaHit(who, DAY, now);
    const rows = await db!.execute<{ n: string }>(sql`SELECT (SELECT count(*) FROM ai_leases WHERE key = ${hashKey(who)}) + (SELECT count(*) FROM rate_hits WHERE key = ${hashKey(who)}) AS n`);
    expect(Number(rows[0].n)).toBe(2);
    const leaks = await db!.execute<{ n: string }>(sql`SELECT (SELECT count(*) FROM ai_leases WHERE key LIKE '%r_secretreaderid%' OR key LIKE '%203.0.113.77%') + (SELECT count(*) FROM rate_hits WHERE key LIKE '%r_secretreaderid%' OR key LIKE '%203.0.113.77%') AS n`);
    expect(Number(leaks[0].n)).toBe(0);
  });

  it("sets money aside atomically: forty simultaneous requests for a budget that fits ten start exactly ten", async () => {
    const now = nextMonth();
    const limits = { dailyMicro: 1_000_000, monthlyMicro: 100_000_000 };
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => store.reserve(`${run}:r${i}`, 100_000, limits, 60_000, now)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "daily")).toBe(true);
    expect((await store.usage(now)).reservedMicro).toBe(1_000_000);
  });

  it("charges what a request used, frees what it had set aside, and makes room for the next", async () => {
    const now = nextMonth();
    const limits = { dailyMicro: 300_000, monthlyMicro: 100_000_000 };
    expect((await store.reserve(`${run}:a`, 200_000, limits, 60_000, now)).ok).toBe(true);
    expect((await store.reserve(`${run}:b`, 200_000, limits, 60_000, now)).ok).toBe(false);
    await store.settle(`${run}:a`, { micro: 20_000, inputTokens: 900, outputTokens: 400, errors: 0 }, now);
    const u = await store.usage(now);
    expect(u.reservedMicro).toBe(0);
    expect(u.day).toMatchObject({ spentMicro: 20_000, requests: 1, errors: 0, inputTokens: 900, outputTokens: 400 });
    expect((await store.reserve(`${run}:b`, 200_000, limits, 60_000, now)).ok).toBe(true); // 20 000 spent + 200 000 fits in 300 000
  });

  it("counts the month as well as the day, and starts a new day with a new daily budget", async () => {
    const now = nextMonth();
    const limits = { dailyMicro: 100_000, monthlyMicro: 150_000 };
    expect((await store.reserve(`${run}:m1`, 90_000, limits, 60_000, now)).ok).toBe(true);
    await store.settle(`${run}:m1`, { micro: 90_000, inputTokens: 1, outputTokens: 1, errors: 0 }, now);
    expect((await store.reserve(`${run}:m2`, 50_000, limits, 60_000, now)).ok).toBe(false); // the day is full
    const tomorrow = now + DAY;
    expect((await store.reserve(`${run}:m3`, 50_000, limits, 60_000, tomorrow)).ok).toBe(true); // a new day, month 140 000 of 150 000 once settled
    await store.settle(`${run}:m3`, { micro: 50_000, inputTokens: 1, outputTokens: 1, errors: 0 }, tomorrow);
    const r = await store.reserve(`${run}:m4`, 20_000, limits, 60_000, tomorrow);
    expect(r).toEqual({ ok: false, reason: "monthly" }); // the day has room (50 000 of 100 000) but the month does not
    expect((await store.usage(tomorrow)).month.spentMicro).toBe(140_000);
  });

  it("a reservation whose request never came back stops holding money once it has expired", async () => {
    const now = nextMonth();
    const limits = { dailyMicro: 100_000, monthlyMicro: 100_000_000 };
    expect((await store.reserve(`${run}:x1`, 80_000, limits, 60_000, now)).ok).toBe(true);
    expect((await store.reserve(`${run}:x2`, 80_000, limits, 60_000, now + 30_000)).ok).toBe(false);
    expect((await store.reserve(`${run}:x3`, 80_000, limits, 60_000, now + 61_000)).ok).toBe(true);
  });

  it("records errors for the health check, by hour", async () => {
    const now = nextMonth();
    await store.settle(`${run}:e1`, { micro: 0, inputTokens: 0, outputTokens: 0, errors: 1 }, now);
    await store.settle(`${run}:e2`, { micro: 10, inputTokens: 5, outputTokens: 5, errors: 0 }, now);
    const u = await store.usage(now);
    expect(u.lastHour).toEqual({ requests: 2, errors: 1 });
    expect((await store.usage(now + 2 * 3_600_000)).lastHour).toEqual({ requests: 0, errors: 0 });
  });

  it("tells the size of the database, for the storage alert", async () => {
    const bytes = await store.storageBytes!();
    expect(bytes).toBeGreaterThan(0);
  });

  it("answers ping when the database is there", async () => {
    await expect(store.ping()).resolves.toBeUndefined();
  });
});
