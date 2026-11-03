import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { aiStore } from "./aiStore";

/**
 * Retention of `analytics_events`: rows older than `GLOSS_ANALYTICS_RETENTION_DAYS` (default 120) are deleted. Explicit, not probabilistic:
 *
 *  - The deletion is in small batches (`GLOSS_ANALYTICS_PRUNE_BATCH`, default 1000), each its own short transaction with a statement timeout, so no
 *    long transaction is ever held and a big backlog is worked off over several runs. A run stops at `GLOSS_ANALYTICS_PRUNE_MAX_BATCHES` batches or
 *    `GLOSS_ANALYTICS_PRUNE_MAX_MS` milliseconds, whichever comes first, and says whether it finished (`done`).
 *  - It is idempotent (the same cutoff twice deletes nothing the second time) and safe to run from several places at once: each batch picks its rows
 *    with `FOR UPDATE SKIP LOCKED`, so two runs never wait for each other or delete the same row.
 *  - The `at` index (`analytics_events_at_idx`) serves the selection; no scan of the table.
 *  - It never throws. A failure is classified (`missing-table`, `timeout`, `error`), logged without any content, and returned.
 *  - Who runs it: an hourly claim made by whichever instance records an event (exactly one instance per hour, across all of them: see
 *    `maybeRunRetention`; `GLOSS_ANALYTICS_AUTO_RETENTION=off` turns it off), the operator's `scripts/analytics-prune.mjs`, and the token-guarded maintenance endpoint for an external scheduler. When
 *    analytics is off nothing runs by itself and the collector stays inert; run the script or the endpoint once to clear what an earlier period left.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const int = (name: string, fallback: number, lo: number, hi: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, Math.floor(n))) : fallback;
};

export interface RetentionPolicy {
  /** Rows older than this many days are deleted. */
  days: number;
  /** Rows deleted per batch (one short transaction each). */
  batch: number;
  maxBatches: number;
  maxMs: number;
}

export const retentionPolicy = (): RetentionPolicy => ({
  days: int("GLOSS_ANALYTICS_RETENTION_DAYS", 120, 1, 3650),
  batch: int("GLOSS_ANALYTICS_PRUNE_BATCH", 1000, 50, 10_000),
  maxBatches: int("GLOSS_ANALYTICS_PRUNE_MAX_BATCHES", 20, 1, 200),
  maxMs: int("GLOSS_ANALYTICS_PRUNE_MAX_MS", 4000, 200, 20_000),
});

export type RetentionFailure = "missing-table" | "timeout" | "error";

export interface RetentionResult {
  ok: boolean;
  /** Rows with `at` before this (epoch ms) are past retention. */
  cutoff: number;
  deleted: number;
  batches: number;
  /** True when a batch came back short: nothing past retention is left (at that moment). False when the run stopped at its limits or failed. */
  done: boolean;
  ms: number;
  failure?: RetentionFailure;
  /** The `now` the run used. */
  at: number;
}

export interface RetentionDeps {
  /** Deletes up to `batch` rows older than `cutoff` and answers how many went. Defaults to the database. */
  deleteBatch?: (cutoff: number, batch: number) => Promise<number>;
  clock?: () => number;
}

type TxRunner = { transaction<T>(fn: (tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }) => Promise<T>): Promise<T> };

/** One batch: its own short transaction, with a statement timeout, deleting rows past retention in `at` order, skipping any row another run holds. */
export async function deleteExpiredBatch(db: TxRunner, cutoff: number, batch: number, statementTimeoutMs = 2500): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${Math.max(100, Math.floor(statementTimeoutMs))}`));
    const rows = (await tx.execute(sql`
      WITH d AS (
        DELETE FROM analytics_events
        WHERE id IN (SELECT id FROM analytics_events WHERE at < ${cutoff} ORDER BY at LIMIT ${batch} FOR UPDATE SKIP LOCKED)
        RETURNING 1)
      SELECT count(*)::int AS n FROM d`)) as unknown as { n: number }[];
    return Number(rows[0]?.n ?? 0);
  });
}

const pgCode = (err: unknown): string | undefined => {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
};

export function classifyFailure(err: unknown): RetentionFailure {
  const code = pgCode(err);
  if (code === "42P01") return "missing-table";
  if (code === "57014" || (err as { name?: string } | null)?.name === "TimeoutError") return "timeout";
  return "error";
}

let lastResult: RetentionResult | null = null;
export const lastRetentionResult = () => lastResult;
export const resetRetentionState = () => {
  lastResult = null;
  lastClaimHour = -1;
};

/** Runs retention now: bounded, idempotent, never throws. */
export async function runRetention(now: number = Date.now(), deps: RetentionDeps = {}): Promise<RetentionResult> {
  const policy = retentionPolicy();
  const cutoff = now - policy.days * DAY_MS;
  const clock = deps.clock ?? Date.now;
  const started = clock();
  let deleted = 0;
  let batches = 0;
  let done = false;
  let failure: RetentionFailure | undefined;
  try {
    let del = deps.deleteBatch;
    if (!del) {
      const db = getDb();
      if (!db) {
        done = true; // no database, so no table: there is nothing past retention anywhere
      } else {
        del = (c, b) => deleteExpiredBatch(db as unknown as TxRunner, c, b);
      }
    }
    while (del && batches < policy.maxBatches && clock() - started < policy.maxMs) {
      const n = await del(cutoff, policy.batch);
      batches += 1;
      deleted += n;
      if (n < policy.batch) {
        done = true;
        break;
      }
    }
  } catch (err) {
    failure = classifyFailure(err);
  }
  const result: RetentionResult = { ok: !failure, cutoff, deleted, batches, done: !failure && done, ms: Math.max(0, clock() - started), ...(failure ? { failure } : {}), at: now };
  lastResult = result;
  // Content-free: counts, timings and a failure class. Never a row, an actor or an error message (which may echo a query).
  console.info(JSON.stringify({ event: "analytics.retention", ok: result.ok, deleted, batches, done: result.done, ms: result.ms, ...(failure ? { failure } : {}) }));
  return result;
}

/** `GLOSS_ANALYTICS_AUTO_RETENTION=off` (or `0`) stops the hourly run that recorded events trigger, for an operator who schedules retention themselves. */
const autoRetentionOff = () => ["off", "0", "false", "no"].includes((process.env.GLOSS_ANALYTICS_AUTO_RETENTION ?? "").trim().toLowerCase());

const CLAIM_KEY = "analytics:retention";
let lastClaimHour = -1;

/**
 * Runs retention at most once per UTC hour across ALL instances: the first caller of the hour wins an atomic one-use reservation (the same primitive
 * that caps events), everyone else gets `null` at once. An instance that already knows the hour is taken does not even ask the database.
 */
export async function maybeRunRetention(now: number = Date.now(), deps: RetentionDeps = {}): Promise<RetentionResult | null> {
  if (autoRetentionOff()) return null; // the operator runs retention from a scheduler or by hand: no claim is made, nothing runs by itself
  const hour = Math.floor(now / HOUR_MS);
  if (hour === lastClaimHour) return null;
  lastClaimHour = hour;
  try {
    if ((await aiStore().quotaReserve(CLAIM_KEY, HOUR_MS, now, 1, 1)) < 1) return null;
  } catch {
    return null; // the claim cannot be made (database trouble): do not pile a deletion on top of it
  }
  return runRetention(now, deps);
}

export interface RetentionStatus {
  policy: RetentionPolicy;
  cutoff: number;
  lastRun: RetentionResult | null;
  /** Rows past retention right now, counted up to 100,000 (a bounded count). Null when it cannot be read. */
  expiredRows: number | null;
  expiredRowsCapped: boolean;
}

/** What an operator wants to see: the policy, the last run this instance knows of, and how many rows are overdue. */
export async function retentionStatus(now: number = Date.now()): Promise<RetentionStatus> {
  const policy = retentionPolicy();
  const cutoff = now - policy.days * DAY_MS;
  let expiredRows: number | null = null;
  const db = getDb();
  if (db) {
    try {
      const rows = (await db.execute(sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM analytics_events WHERE at < ${cutoff} LIMIT 100001) t`)) as unknown as { n: number }[];
      expiredRows = Number(rows[0]?.n ?? 0);
    } catch {
      expiredRows = null;
    }
  } else {
    expiredRows = 0;
  }
  return { policy, cutoff, lastRun: lastResult, expiredRows, expiredRowsCapped: expiredRows !== null && expiredRows > 100_000 };
}
