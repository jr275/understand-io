import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

/**
 * The counter every instance of the app shares. The in-memory limiter in `rateLimit.ts` only sees the requests that reached its own
 * process, which on serverless hosting is a different process per burst of traffic; this store keeps one count per client and fixed
 * window in the database, so the limit holds for the whole deployment. A fixed window lets a client use up to twice the limit across
 * a window boundary; that is the price of one atomic statement per request.
 */
export interface SharedCounter {
  /** Counts one hit for `key` in the window `now` falls in, and answers the count so far and when the window ends. */
  hit(key: string, windowMs: number, now: number): Promise<{ count: number; resetMs: number }>;
}

/** A client address or reader id is stored only as a hash, so the table holds no addresses. */
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32);

/** The counter is a convenience on the request path: past this, the request goes on and only the per-process limit applies. */
export const SHARED_TIMEOUT_MS = 1500;

/** One in this many hits also deletes the windows that are over. */
const SWEEP_ONE_IN = 50;

export const databaseCounter: SharedCounter = {
  async hit(key, windowMs, now) {
    const db = getDb();
    if (!db) throw new Error("no database");
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const rows = await db.execute<{ count: number }>(sql`
      INSERT INTO rate_hits (key, window_start, count, expires_at)
      VALUES (${hashKey(key)}, ${windowStart}, 1, ${windowStart + 2 * windowMs})
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_hits.count + 1
      RETURNING count`);
    if (Math.random() * SWEEP_ONE_IN < 1) void db.execute(sql`DELETE FROM rate_hits WHERE expires_at < ${now}`).catch(() => {});
    return { count: Number(rows[0]?.count ?? 1), resetMs: Math.max(1, windowStart + windowMs - now) };
  },
};

/** True when there is a database to count in. */
export const sharedCounterAvailable = () => !!process.env.DATABASE_URL;
