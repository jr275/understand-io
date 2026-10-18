import { READER_COOKIE, verifyReaderCookie } from "./reader";

/**
 * In-memory sliding-window limiter for calls that spend the operator's own provider key. It lives in the
 * memory of one Node process: with several instances (or serverless functions) each keeps its own counters,
 * so the effective limit is `instances x limit`. A shared store (Redis, KV) is needed for a hard global cap.
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

/**
 * Call only when the request would be paid for by the server key (the reader's own key is unmetered).
 * Returns a 429 Response when the reader or the client address has used up its budget, otherwise null.
 */
export function limitServerKey(req: Request, bucket: LimitBucket): Response | null {
  const cfg = limitFor(bucket);
  if (!cfg) return null;
  const keys = [`${bucket}:ip:${clientIp(req)}`];
  const reader = readerFromCookieHeader(req);
  if (reader) keys.push(`${bucket}:reader:${reader}`);
  let blocked = 0;
  for (const k of keys) {
    const r = limiter.hit(k, cfg.max, cfg.windowMs);
    if (!r.ok) blocked = Math.max(blocked, r.retryAfterMs);
  }
  if (!blocked) return null;
  const secs = Math.ceil(blocked / 1000);
  const wait = secs >= 120 ? `${Math.ceil(secs / 60)} minutes` : `${secs} seconds`;
  return Response.json(
    { error: "rate-limited", message: `The shared key allows ${cfg.max} of these per ${windowLabel(cfg.windowMs)}. Try again in about ${wait}, or add your own Together key with the key button in the top bar (your own key is not limited here).` },
    { status: 429, headers: { "retry-after": String(secs), "cache-control": "no-store" } },
  );
}

function windowLabel(ms: number) {
  const m = Math.round(ms / 60000);
  if (m >= 60 && m % 60 === 0) return m === 60 ? "hour" : `${m / 60} hours`;
  return m >= 1 ? `${m} minutes` : `${Math.round(ms / 1000)} seconds`;
}

/** Test hook: forget all counters. */
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
 * Call at the top of every import route. A speed bump against a client that loops: the counters live in one process's
 * memory (see the note above), so on several instances the cap is per instance. Returns a 429 Response or null.
 */
export function limitImports(req: Request): Response | null {
  const cfg = importLimit();
  if (!cfg) return null;
  const keys = [`import:ip:${clientIp(req)}`];
  const reader = readerFromCookieHeader(req);
  if (reader) keys.push(`import:reader:${reader}`);
  let blocked = 0;
  for (const k of keys) {
    const r = limiter.hit(k, cfg.max, cfg.windowMs);
    if (!r.ok) blocked = Math.max(blocked, r.retryAfterMs);
  }
  if (!blocked) return null;
  const secs = Math.ceil(blocked / 1000);
  const wait = secs >= 120 ? `${Math.ceil(secs / 60)} minutes` : `${secs} seconds`;
  return Response.json(
    // `error` is what the import screen shows the reader (as in every import route); `code` is for programs.
    { error: `That is more than ${cfg.max} imports in ${Math.round(cfg.windowMs / 60000)} minutes. Try again in about ${wait}.`, code: "rate-limited" },
    { status: 429, headers: { "retry-after": String(secs), "cache-control": "no-store" } },
  );
}

export function resetRateLimits() {
  limiter.clear();
}
