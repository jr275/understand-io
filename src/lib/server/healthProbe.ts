import { budgetLimits } from "@/lib/ai/budget";
import { aiStore } from "@/lib/server/aiStore";

/** The database must answer within this, or it counts as down (a hung connection is an outage for the reader too). */
const DB_TIMEOUT_MS = 3000;
/**
 * A healthy answer is reused for this long (per instance) so that a monitor polling every few minutes does not keep the database awake: on Neon Free the
 * compute suspends after 5 idle minutes and the plan has a monthly compute allowance. A failure is never reused (recovery is seen at once); `?fresh=1` skips the reuse.
 */
const DEFAULT_CACHE_SECONDS = 900;
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
let lastGood: { key: string; probe: Probe } | null = null;

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
export async function probe(now: number, fresh: boolean): Promise<{ probe: Probe; cached: boolean }> {
  const key = process.env.DATABASE_URL ?? "";
  const ttl = whole("GLOSS_HEALTH_DB_CACHE_SECONDS", DEFAULT_CACHE_SECONDS) * 1000;
  if (!fresh && lastGood && lastGood.key === key && now - lastGood.probe.at < ttl) return { probe: lastGood.probe, cached: true };
  let result: Probe;
  try {
    result = await probeOnce(now);
  } catch {
    result = await probeOnce(Date.now());
  }
  lastGood = { key, probe: result };
  return { probe: result, cached: false };
}

/** For tests: forget the last healthy reading. */
export function forgetHealthCache() {
  lastGood = null;
}

