import { READER_COOKIE, verifyReaderCookie } from "./reader";
import { SHARED_TIMEOUT_MS, databaseCounter, sharedCounterAvailable, type SharedCounter } from "./rateStore";

/**
 * Two layers count every limited call. The shared counter (`rateStore.ts`, one row per client and window in the database) is what
 * makes a limit hold across instances. The in-memory sliding window below lives in one Node process: it is the first, cheap check, and
 * the only one when there is no database or the database does not answer in time, in which case each instance keeps its own counters
 * and the effective limit is `instances x limit`. A request is refused when either layer says so.
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(private maxKeys = 20000) {}

  /** Records one attempt for `key` unless it already has `max` within `windowMs`. */
  hit(key: string, max: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterMs: number; remaining: number } {
    const since = now - windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length >= max) {
      this.hits.set(key, list);
      return { ok: false, retryAfterMs: Math.max(1, list[0] + windowMs - now), remaining: 0 };
    }
    list.push(now);
    this.hits.delete(key); // re-insert so the Map keeps recently used keys last
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.sweep(now, windowMs);
    return { ok: true, retryAfterMs: 0, remaining: max - list.length };
  }

  private sweep(now: number, windowMs: number) {
    for (const [k, list] of this.hits) if (list[list.length - 1] <= now - windowMs) this.hits.delete(k);
    // Still too many live keys: drop the least recently used ones.
    for (const k of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys * 0.9) break;
      this.hits.delete(k);
    }
  }

  clear() {
    this.hits.clear();
  }
}

export type LimitBucket = "gloss" | "search" | "transcribe";

const DEFAULT_MAX: Record<LimitBucket, number> = { gloss: 30, search: 60, transcribe: 15 };
const ENV_NAME: Record<LimitBucket, string> = { gloss: "GLOSS_RATE_GLOSS", search: "GLOSS_RATE_SEARCH", transcribe: "GLOSS_RATE_TRANSCRIBE" };

/** Requests allowed per window and per key (reader id, client IP) when the server key pays; null when switched off. Read on each call so tests and operators can change the environment. */
export function limitFor(bucket: LimitBucket): { max: number; windowMs: number } | null {
  const raw = process.env[ENV_NAME[bucket]]?.trim().toLowerCase();
  if (raw === "off" || raw === "0") return null;
  const n = Number(raw);
  const max = raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX[bucket];
  const w = Number(process.env.GLOSS_RATE_WINDOW_SEC);
  const windowSec = Number.isFinite(w) && w > 0 ? w : 3600;
  return { max, windowMs: Math.round(windowSec * 1000) };
}

const limiter = new SlidingWindowLimiter();

/** Client address as reported by the platform proxy (`x-forwarded-for` / `x-real-ip`). Only trustworthy behind a proxy that sets them. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || req.headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
}

function readerFromCookieHeader(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === READER_COOKIE) return verifyReaderCookie(part.slice(i + 1).trim());
  }
  return null;
}

let sharedCounter: SharedCounter | null | undefined;
/** Test seam: replace the shared counter (`null` switches the shared layer off, `undefined` restores the database). */
export function setSharedCounter(c: SharedCounter | null | undefined) {
  sharedCounter = c;
}
const activeCounter = (): SharedCounter | null => (sharedCounter !== undefined ? sharedCounter : sharedCounterAvailable() ? databaseCounter : null);

/** How long (ms) until the caller may try again, or 0 when the request is within its budget. Counts the request in both layers. */
async function spend(req: Request, bucket: string, max: number, windowMs: number): Promise<number> {
  const keys = [`${bucket}:ip:${clientIp(req)}`];
  const reader = readerFromCookieHeader(req);
  if (reader) keys.push(`${bucket}:reader:${reader}`);
  let blocked = 0;
  for (const k of keys) {
    const r = limiter.hit(k, max, windowMs);
    if (!r.ok) blocked = Math.max(blocked, r.retryAfterMs);
  }
  if (blocked) return blocked;
  const counter = activeCounter();
  if (!counter) return 0;
  const now = Date.now();
  try {
    const answers = await Promise.all(keys.map((k) => withTimeout(counter.hit(k, windowMs, now), SHARED_TIMEOUT_MS)));
    for (const a of answers) if (a.count > max) blocked = Math.max(blocked, a.resetMs);
  } catch (err) {
    // The shared count is unavailable: only this process's count applies until it is back. Say so once in a while, never with the key.
    if (Date.now() - lastSharedWarning > 60_000) {
      lastSharedWarning = Date.now();
      console.warn(`[rate] shared counter unavailable, limiting per instance only (${err instanceof Error ? err.name : typeof err})`);
    }
  }
  return blocked;
}
let lastSharedWarning = 0;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error("timeout")), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

const waitText = (secs: number) => (secs >= 120 ? `${Math.ceil(secs / 60)} minutes` : `${secs} seconds`);

/**
 * Call only when the request would be paid for by the server key (the reader's own key is unmetered).
 * Returns a 429 Response when the reader or the client address has used up its budget, otherwise null.
 */
export async function limitServerKey(req: Request, bucket: LimitBucket): Promise<Response | null> {
  const cfg = limitFor(bucket);
  if (!cfg) return null;
  const blocked = await spend(req, bucket, cfg.max, cfg.windowMs);
  if (!blocked) return null;
  const secs = Math.ceil(blocked / 1000);
  return Response.json(
    { error: "rate-limited", message: `The shared key allows ${cfg.max} of these per ${windowLabel(cfg.windowMs)}. Try again in about ${waitText(secs)}, or add your own Together key with the key button in the top bar (your own key is not limited here).` },
    { status: 429, headers: { "retry-after": String(secs), "cache-control": "no-store" } },
  );
}

function windowLabel(ms: number) {
  const m = Math.round(ms / 60000);
  if (m >= 60 && m % 60 === 0) return m === 60 ? "hour" : `${m / 60} hours`;
  return m >= 1 ? `${m} minutes` : `${Math.round(ms / 1000)} seconds`;
}

/** Imports per window and per key. Imports fetch other sites and parse files, so they cost server time even without any provider key. */
const IMPORT_MAX = 60;
const IMPORT_WINDOW_MS = 10 * 60 * 1000;

/** Requests allowed per `IMPORT_WINDOW_MS` and per key (reader id, client IP); null when switched off (`GLOSS_RATE_IMPORT=off`). */
export function importLimit(): { max: number; windowMs: number } | null {
  const raw = process.env.GLOSS_RATE_IMPORT?.trim().toLowerCase();
  if (raw === "off" || raw === "0") return null;
  const n = Number(raw);
  return { max: raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : IMPORT_MAX, windowMs: IMPORT_WINDOW_MS };
}

/**
 * Call at the top of every import route. Counted per client address and reader, in the shared store when there is one (see the note
 * at the top). Returns a 429 Response or null.
 */
export async function limitImports(req: Request): Promise<Response | null> {
  const cfg = importLimit();
  if (!cfg) return null;
  const blocked = await spend(req, "import", cfg.max, cfg.windowMs);
  if (!blocked) return null;
  const secs = Math.ceil(blocked / 1000);
  return Response.json(
    // `error` is what the import screen shows the reader (as in every import route); `code` is for programs.
    { error: `That is more than ${cfg.max} imports in ${Math.round(cfg.windowMs / 60000)} minutes. Try again in about ${waitText(secs)}.`, code: "rate-limited" },
    { status: 429, headers: { "retry-after": String(secs), "cache-control": "no-store" } },
  );
}

/** Test hook: forget all in-process counters. */
export function resetRateLimits() {
  limiter.clear();
}
