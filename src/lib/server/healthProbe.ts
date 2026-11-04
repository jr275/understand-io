import { budgetLimits } from "@/lib/ai/budget";
import { aiStore } from "@/lib/server/aiStore";

/** The database must answer within this, or it counts as down (a hung connection is an outage for the reader too). */
const DB_TIMEOUT_MS = 3000;
/**
 * A healthy answer is reused for this long (per instance) so that a monitor polling every few minutes does not keep the database awake: on Neon Free the
 * compute suspends after 5 idle minutes and the plan has a monthly compute allowance. `fresh` (only an authenticated caller can ask for it, see
 * `readiness.ts`) skips this reuse, but never the floor below.
 */
const DEFAULT_CACHE_SECONDS = 900;
/**
 * Whatever the caller asks, a real reading is never made more often than this (per instance), success or failure. It bounds what a leaked token, a
 * misconfigured monitor or a retry storm can cost the database, and it is what stops a down database from being hammered by the checks themselves.
 */
const DEFAULT_MIN_PROBE_SECONDS = 10;
/** The whole reading, both attempts included, is abandoned after this: a check must always come back. */
const PROBE_DEADLINE_MS = 8000;
/** Neon Free keeps 1 GB per project; set `GLOSS_DB_STORAGE_LIMIT_MB` to the plan's real number. */
export const DEFAULT_STORAGE_LIMIT_MB = 1024;
export const STORAGE_WATCH = 0.7;
export const STORAGE_HIGH = 0.85;

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error("timeout")), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

export const whole = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isFinite(v) && v >= 0 ? v : fallback;
};

export interface Probe {
  at: number;
  budget: "ok" | "low" | "exhausted" | "unknown";
  errorsLastHour: number;
  requestsLastHour: number;
  storageBytes: number | null;
}
type Outcome = { key: string; at: number; probe: Probe } | { key: string; at: number; error: true };
let last: Outcome | null = null;
let inflight: { key: string; promise: Promise<Probe> } | null = null;

/** One reading of the database: it answers, the ledger, and the size. Throws when the database cannot be reached in time. */
async function probeOnce(now: number): Promise<Probe> {
  const store = aiStore();
  await within(store.ping(), DB_TIMEOUT_MS);
  const u = await within(store.usage(now), DB_TIMEOUT_MS);
  const daily = budgetLimits().dailyMicro;
  const used = u.day.spentMicro + u.reservedMicro;
  const storageBytes = store.storageBytes ? await within(store.storageBytes(), DB_TIMEOUT_MS).catch(() => null) : null;
  return {
    at: now,
    budget: daily <= 0 || used >= daily ? "exhausted" : used >= daily * 0.8 ? "low" : "ok",
    errorsLastHour: u.lastHour.errors,
    requestsLastHour: u.lastHour.requests,
    storageBytes,
  };
}

/** A sleeping Neon compute can take a moment to wake, so one failed reading is repeated once before the database is called down. */
async function read(now: number): Promise<Probe> {
  try {
    return await probeOnce(now);
  } catch {
    return probeOnce(Date.now());
  }
}

/**
 * The database reading behind the readiness check. It is bounded in every way that matters when the caller is not to be trusted with the database:
 *  - at most one reading at a time per instance: concurrent callers share the one in flight;
 *  - at most one reading per `GLOSS_HEALTH_MIN_PROBE_SECONDS` (default 10), `fresh` or not, success or failure (a failure is reused for that long);
 *  - a healthy reading is reused for `GLOSS_HEALTH_DB_CACHE_SECONDS` (default 15 minutes) unless `fresh`;
 *  - the whole reading, both attempts, is abandoned after 8 seconds.
 * Throws when the database cannot be reached in time.
 */
export async function probe(now: number, fresh: boolean): Promise<{ probe: Probe; cached: boolean }> {
  const key = process.env.DATABASE_URL ?? "";
  const ttl = whole("GLOSS_HEALTH_DB_CACHE_SECONDS", DEFAULT_CACHE_SECONDS) * 1000;
  const floor = whole("GLOSS_HEALTH_MIN_PROBE_SECONDS", DEFAULT_MIN_PROBE_SECONDS) * 1000;
  if (inflight && inflight.key === key) return { probe: await inflight.promise, cached: true };
  if (last && last.key === key) {
    const age = now - last.at;
    if (age >= 0 && age < floor) return reuse(last);
    if ("probe" in last && !fresh && age >= 0 && age < ttl) return reuse(last);
  }
  const promise = within(read(now), PROBE_DEADLINE_MS);
  const mine = { key, promise };
  inflight = mine;
  try {
    const result = await promise;
    last = { key, at: now, probe: result };
    return { probe: result, cached: false };
  } catch (err) {
    last = { key, at: now, error: true };
    throw err;
  } finally {
    if (inflight === mine) inflight = null;
  }
}

function reuse(o: Outcome): { probe: Probe; cached: boolean } {
  if ("error" in o) throw new Error("database-down");
  return { probe: o.probe, cached: true };
}

/** For tests: forget the last reading and any reading in flight. */
export function forgetHealthCache() {
  last = null;
  inflight = null;
}
