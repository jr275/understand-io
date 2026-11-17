// The event cap and retention against the real local PostgreSQL (DATABASE_URL), like analyticsDatabase.test.ts.
//
// Isolation: the reservation tests use a window in the year 2100 that is unique to the run (and are cleaned up by window), so they never touch a
// counter anyone else uses. Every retention, contention and large-data test runs in a private schema with its own copy of `analytics_events`, because
// another test file deletes expired rows from the shared table and must not be disturbed (nor disturb these).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { aiStore } from "@/lib/server/aiStore";
import { handleEvents, resetAnalyticsLimits } from "@/lib/server/analytics";
import { deleteExpiredBatch, maybeRunRetention, resetRetentionState, runRetention } from "@/lib/server/analyticsRetention";

const db = process.env.DATABASE_URL ? getDb() : null;
const DAY = 86_400_000;
const run = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const baseDay = Date.UTC(2100, 0, 1) + (Math.floor(Math.random() * 20_000) + 1) * DAY; // unique to this run
let dayNo = 0;
const nextDay = () => baseDay + dayNo++ * 3 * DAY;
const KEY = `analytics:cap-test-${run}`;
const SCHEMA = `cap_${run}`.toLowerCase();
const EMPTY_SCHEMA = `${SCHEMA}_empty`;

const q = async <T = Record<string, unknown>>(text: ReturnType<typeof sql>) => (await db!.execute(text)) as unknown as T[];
// A day window and an hour window can start at the same instant (the hourly retention claim), so take the largest: the day's counter.
const countAt = async (ws: number) => Number((await q<{ count: number }>(sql`SELECT coalesce(max(count), 0)::int AS count FROM rate_hits WHERE window_start = ${ws}`))[0]?.count ?? 0);

/** A database that runs everything inside the private schema (search_path is transaction-local, so it also works through a pooler). */
const scoped = (schema: string) => ({
  transaction: <T>(fn: (tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }) => Promise<T>) =>
    db!.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL search_path TO ${schema}`));
      return fn(tx);
    }),
});
const seed = (schema: string, expired: number, fresh: number, expiredAt: number, freshAt: number) =>
  db!.execute(sql.raw(`
    INSERT INTO ${schema}.analytics_events (at, event, actor, actor_kind, props)
    SELECT ${expiredAt} + g, 'landing_viewed', 'seed-' || g, 'daily', '{}'::jsonb FROM generate_series(1, ${expired}) g;
    INSERT INTO ${schema}.analytics_events (at, event, actor, actor_kind, props)
    SELECT ${freshAt} + g, 'landing_viewed', 'seed-fresh-' || g, 'daily', '{}'::jsonb FROM generate_series(1, ${fresh}) g`));
const rows = async (schema: string, where = "true") => Number((await q<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM ${schema}.analytics_events WHERE ${where}`)))[0].n);

describe.skipIf(!db)("the event cap against real PostgreSQL", () => {
  const windows: number[] = [];
  const day = () => (windows.push(nextDay()), windows[windows.length - 1]);
  afterAll(async () => {
    for (const ws of windows) await db!.execute(sql`DELETE FROM rate_hits WHERE window_start = ${ws}`);
  });

  it("three hundred simultaneous reservations of seven against a cap of one thousand grant exactly one thousand, never more", async () => {
    const now = day();
    const granted = await Promise.all(Array.from({ length: 300 }, () => aiStore().quotaReserve(KEY, DAY, now, 7, 1000)));
    expect(granted.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(Math.max(...granted)).toBeLessThanOrEqual(7);
    expect(granted.filter((g) => g > 0 && g < 7)).toHaveLength(1); // exactly one request got the remainder (1000 = 142 * 7 + 6)
    expect(await countAt(now)).toBe(1000);
  });

  it("requests of every size racing for a cap of 777 still total 777", async () => {
    const now = day();
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const sizes = Array.from({ length: 200 }, () => 1 + Math.floor(rnd() * 25));
    expect(sizes.reduce((a, b) => a + b, 0)).toBeGreaterThan(777);
    const granted = await Promise.all(sizes.map((n) => aiStore().quotaReserve(KEY, DAY, now, n, 777)));
    expect(granted.reduce((a, b) => a + b, 0)).toBe(777);
    granted.forEach((g, i) => expect(g).toBeLessThanOrEqual(sizes[i]));
    expect(await countAt(now)).toBe(777);
  });

  it("a request that wants more than the whole cap gets the cap, once", async () => {
    const now = day();
    expect(await aiStore().quotaReserve(KEY, DAY, now, 10_000, 50)).toBe(50);
    expect(await aiStore().quotaReserve(KEY, DAY, now, 1, 50)).toBe(0);
  });

  it("a lowered cap grants nothing and does not erase what was counted", async () => {
    const now = day();
    expect(await aiStore().quotaReserve(KEY, DAY, now, 500, 1000)).toBe(500);
    expect(await aiStore().quotaReserve(KEY, DAY, now, 10, 100)).toBe(0);
    expect(await countAt(now)).toBe(500);
    expect(await aiStore().quotaReserve(KEY, DAY, now, 10, 1000)).toBe(10);
  });

  it("gives reservations back, never below zero", async () => {
    const now = day();
    await aiStore().quotaReserve(KEY, DAY, now, 10, 100);
    await aiStore().quotaRelease(KEY, DAY, now, 4);
    expect(await countAt(now)).toBe(6);
    await aiStore().quotaRelease(KEY, DAY, now, 100);
    expect(await countAt(now)).toBe(0);
    await aiStore().quotaRelease(KEY, DAY, now, 5);
    expect(await countAt(now)).toBe(0);
  });

  it("nonsense requests grant nothing", async () => {
    const now = day();
    for (const [n, cap] of [[0, 10], [-3, 10], [5, 0], [5, -1], [Number.NaN, 10]] as const) expect(await aiStore().quotaReserve(KEY, DAY, now, n, cap)).toBe(0);
  });

  it("the day boundary is UTC midnight: the last millisecond and the first are different counters", async () => {
    const midnight = day() + DAY; // a UTC midnight
    expect(await aiStore().quotaReserve(KEY, DAY, midnight - 1, 5, 5)).toBe(5);
    expect(await aiStore().quotaReserve(KEY, DAY, midnight - 1, 1, 5)).toBe(0);
    expect(await aiStore().quotaReserve(KEY, DAY, midnight, 5, 5)).toBe(5);
    windows.push(midnight);
  });

  it("through the collector: a hundred simultaneous requests of five events against a cap of two hundred store exactly two hundred rows", async () => {
    const now = day();
    vi.stubEnv("GLOSS_ANALYTICS", "full");
    vi.stubEnv("GLOSS_COOKIE_SECRET", "x".repeat(40));
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "200");
    vi.stubEnv("GLOSS_ANALYTICS_AUTO_RETENTION", "off"); // the hourly run would delete every older row of the shared table, other tests' rows included
    resetAnalyticsLimits();
    try {
      const body = JSON.stringify({ events: Array.from({ length: 5 }, () => ({ event: "landing_viewed", props: {}, path: "/" })) });
      const answers = await Promise.all(
        Array.from({ length: 100 }, (_, i) => handleEvents(new Request("http://x.test/api/events", { method: "POST", headers: { "content-type": "application/json", "user-agent": "UA", "x-forwarded-for": `10.9.${i >> 8}.${i & 255}` }, body }), now)),
      );
      expect(answers.every((r) => r.status === 204)).toBe(true);
      const stored = Number((await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM analytics_events WHERE at = ${now}`))[0].n);
      expect(stored).toBe(200);
      expect(await countAt(now)).toBe(200);
    } finally {
      await db!.execute(sql`DELETE FROM analytics_events WHERE at = ${now}`);
      vi.unstubAllEnvs();
      resetAnalyticsLimits();
    }
  });
});

describe.skipIf(!db)("retention against real PostgreSQL, in a private schema", () => {
  const T = Date.UTC(2001, 0, 1); // "now" for these runs: far from anything real, so the cutoff is in 2000
  const OLD = Date.UTC(1990, 0, 1);
  const days = 120;
  const cutoff = T - days * DAY;
  beforeAll(async () => {
    await db!.execute(sql.raw(`CREATE SCHEMA ${SCHEMA}`));
    await db!.execute(sql.raw(`CREATE TABLE ${SCHEMA}.analytics_events (LIKE public.analytics_events INCLUDING ALL)`));
    await db!.execute(sql.raw(`CREATE SCHEMA ${EMPTY_SCHEMA}`));
  });
  afterAll(async () => {
    await db!.execute(sql.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`));
    await db!.execute(sql.raw(`DROP SCHEMA IF EXISTS ${EMPTY_SCHEMA} CASCADE`));
    vi.unstubAllEnvs();
  });
  const reset = () => db!.execute(sql.raw(`TRUNCATE ${SCHEMA}.analytics_events`));
  const deps = (log?: number[]) => ({ deleteBatch: async (c: number, b: number) => { const n = await deleteExpiredBatch(scoped(SCHEMA), c, b); log?.push(n); return n; } });

  it("a large table is worked off in bounded batches: only expired rows go, fresh rows are untouched, no batch exceeds its size", async () => {
    await reset();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_BATCH", "5000");
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_MAX_BATCHES", "10");
    await seed(SCHEMA, 120_000, 40_000, OLD, T);
    expect(await rows(SCHEMA)).toBe(160_000);
    const sizes: number[] = [];
    const first = await runRetention(T, deps(sizes));
    expect(first).toMatchObject({ ok: true, batches: 10, deleted: 50_000, done: false });
    let runs = 1;
    let last = first;
    while (!last.done && runs < 10) {
      last = await runRetention(T, deps(sizes));
      runs++;
    }
    expect(last.done).toBe(true);
    expect(sizes.every((n) => n <= 5000)).toBe(true);
    expect(await rows(SCHEMA, `at < ${cutoff}`)).toBe(0);
    expect(await rows(SCHEMA)).toBe(40_000); // the fresh rows are all still there
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(120_000);
  }, 120_000);

  it("is idempotent on the real table: a second run deletes nothing", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const again = await runRetention(T, deps());
    expect(again).toMatchObject({ ok: true, deleted: 0, done: true });
    expect(await rows(SCHEMA)).toBe(40_000);
  });

  it("selects the rows to delete through the `at` index, not by scanning the table", async () => {
    await reset();
    await seed(SCHEMA, 300, 100_000, OLD, T);
    await db!.execute(sql.raw(`ANALYZE ${SCHEMA}.analytics_events`));
    const plan = await q<{ "QUERY PLAN": string }>(sql.raw(`EXPLAIN SELECT id FROM ${SCHEMA}.analytics_events WHERE at < ${cutoff} ORDER BY at LIMIT 1000`));
    const text = plan.map((p) => p["QUERY PLAN"]).join("\n");
    expect(text).toMatch(/Index (Only )?Scan/);
    expect(text).not.toMatch(/Seq Scan/);
  }, 60_000);

  it("two runs at once never wait for each other, never delete a row twice and never fail: together they delete each expired row exactly once", async () => {
    await reset();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_BATCH", "500");
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_MAX_BATCHES", "200");
    await seed(SCHEMA, 40_000, 1000, OLD, T);
    const [a, b, c] = await Promise.all([runRetention(T, deps()), runRetention(T, deps()), runRetention(T, deps())]);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    expect(a.deleted + b.deleted + c.deleted).toBe(40_000);
    expect(await rows(SCHEMA)).toBe(1000);
  }, 120_000);

  it("while it prunes, writes to the table and reads of it carry on, and the application keeps answering", async () => {
    await reset();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_BATCH", "500");
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_MAX_BATCHES", "200");
    vi.stubEnv("GLOSS_ANALYTICS", "full");
    vi.stubEnv("GLOSS_COOKIE_SECRET", "x".repeat(40));
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "1000000");
    vi.stubEnv("GLOSS_ANALYTICS_AUTO_RETENTION", "off");
    resetAnalyticsLimits();
    await seed(SCHEMA, 60_000, 0, OLD, T);
    const live = Date.UTC(2101, 0, 1) + Math.floor(Math.random() * 1000) * DAY; // a unique timestamp for the collector's rows in the real table
    const pruning = runRetention(T, deps());
    const inserts = Array.from({ length: 100 }, async () => {
      const t0 = Date.now();
      await db!.execute(sql.raw(`INSERT INTO ${SCHEMA}.analytics_events (at, event, actor, actor_kind, props) VALUES (${T + 1}, 'landing_viewed', 'live', 'daily', '{}')`));
      return Date.now() - t0;
    });
    const reads = Array.from({ length: 50 }, () => rows(SCHEMA, `at >= ${cutoff}`));
    const answers = Array.from({ length: 50 }, (_, i) =>
      handleEvents(new Request("http://x.test/api/events", { method: "POST", headers: { "content-type": "application/json", "user-agent": "UA", "x-forwarded-for": `10.8.${i >> 8}.${i & 255}` }, body: JSON.stringify({ events: [{ event: "landing_viewed", props: {}, path: "/" }] }) }), live),
    );
    const [result, latencies, , responses] = await Promise.all([pruning, Promise.all(inserts), Promise.all(reads), Promise.all(answers)]);
    expect(result).toMatchObject({ ok: true, deleted: 60_000, done: true });
    expect(responses.every((r) => r.status === 204)).toBe(true);
    expect(Math.max(...latencies)).toBeLessThan(5000); // nothing waited on the deletion
    expect(await rows(SCHEMA, `actor = 'live'`)).toBe(100); // every concurrent insert landed
    await db!.execute(sql`DELETE FROM analytics_events WHERE at = ${live}`);
    await db!.execute(sql`DELETE FROM rate_hits WHERE window_start = ${Math.floor(live / DAY) * DAY}`);
    resetAnalyticsLimits();
  }, 120_000);

  it("a batch never waits for rows another transaction holds: it takes other rows and leaves the held ones alone", async () => {
    await reset();
    await seed(SCHEMA, 3000, 0, OLD, T);
    let release!: () => void;
    let held!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holding = new Promise<void>((r) => (held = r));
    // Another transaction (say, a slow reader that locked rows, or a second run in the middle of a batch) holds the oldest thousand expired rows.
    const holder = db!.transaction(async (tx) => {
      await tx.execute(sql.raw(`SELECT id FROM ${SCHEMA}.analytics_events WHERE at < ${cutoff} ORDER BY at LIMIT 1000 FOR UPDATE`));
      held();
      await gate;
    });
    await holding;
    try {
      const t0 = Date.now();
      const n = await deleteExpiredBatch(scoped(SCHEMA), cutoff, 500, 500); // a 500 ms statement timeout: waiting for the held rows would exceed it
      expect(n).toBe(500);
      expect(Date.now() - t0).toBeLessThan(450);
      expect(await rows(SCHEMA)).toBe(2500);
    } finally {
      release();
      await holder;
    }
    expect(await rows(SCHEMA, `at < ${OLD + 1001}`)).toBe(1000); // the thousand oldest, the ones that were held, are all still there
  }, 60_000);

  it("a batch that runs past its statement timeout is cancelled whole: nothing is half deleted, and the run reports a timeout", async () => {
    await reset();
    vi.spyOn(console, "info").mockImplementation(() => {});
    await seed(SCHEMA, 2000, 0, OLD, T);
    await db!.execute(sql.raw(`CREATE OR REPLACE FUNCTION ${SCHEMA}.slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.01); RETURN OLD; END $$`));
    await db!.execute(sql.raw(`CREATE TRIGGER slow BEFORE DELETE ON ${SCHEMA}.analytics_events FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.slow()`));
    try {
      const r = await runRetention(T, { deleteBatch: (c, b) => deleteExpiredBatch(scoped(SCHEMA), c, b, 300) }); // 2000 rows * 10 ms >> 300 ms
      expect(r).toMatchObject({ ok: false, failure: "timeout", deleted: 0 });
      expect(await rows(SCHEMA)).toBe(2000); // the cancelled statement rolled back entirely
    } finally {
      await db!.execute(sql.raw(`DROP TRIGGER slow ON ${SCHEMA}.analytics_events`));
    }
    const ok = await runRetention(T, deps()); // and the next run, without the slowness, finishes the job
    expect(ok).toMatchObject({ ok: true, deleted: 2000, done: true });
  }, 60_000);

  it("a missing table is reported as such, never thrown, and nothing else is disturbed", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const r = await runRetention(T, { deleteBatch: (c, b) => deleteExpiredBatch(scoped(EMPTY_SCHEMA), c, b) });
    expect(r).toMatchObject({ ok: false, failure: "missing-table", deleted: 0, done: false });
    expect(await rows(SCHEMA)).toBe(0); // the real work of the previous test is intact
  });

  it("the hourly claim is shared: of several instances only one runs it, and the next hour is open again", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("GLOSS_ANALYTICS_AUTO_RETENTION", ""); // earlier tests switched it off; this one is about it being on
    const hourNow = Date.UTC(2102, 0, 1) + Math.floor(Math.random() * 5000) * DAY;
    const results: unknown[] = [];
    for (let instance = 0; instance < 4; instance++) {
      resetRetentionState(); // each loop is another instance that has never asked
      results.push(await maybeRunRetention(hourNow, { deleteBatch: async () => 0 }));
    }
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    resetRetentionState();
    expect(await maybeRunRetention(hourNow + 3_600_000, { deleteBatch: async () => 0 })).not.toBeNull();
    await db!.execute(sql`DELETE FROM rate_hits WHERE window_start IN (${Math.floor(hourNow / 3_600_000) * 3_600_000}, ${Math.floor((hourNow + 3_600_000) / 3_600_000) * 3_600_000})`);
  });
});
