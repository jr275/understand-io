import { createHash, timingSafeEqual } from "node:crypto";
import { SlidingWindowLimiter, clientIp } from "@/lib/server/rateLimit";

/**
 * A bearer token that switches a route on. It is read from the environment on every call and must be at least 32 characters: without it the route
 * answers 404, exactly as an unknown path would, so its existence is not revealed. With it the caller sends `Authorization: Bearer <token>`.
 * Every attempt counts against a per-address limit, valid or not (a monitor or scheduler calls a few times an hour, so a burst can only be a guess).
 * The limit is in memory, never in the database: a refused or unauthenticated call must cost nothing, and must never wake the database.
 */
export const MIN_TOKEN_LENGTH = 32;

const digest = (v: string) => createHash("sha256").update(v).digest();

export const jsonNoStore = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", "x-robots-tag": "noindex", ...headers } });

export interface BearerOptions {
  /** Name of the environment variable that holds the token. */
  env: string;
  /** Names the counter, so two routes do not share a budget. */
  scope: string;
  limiter: SlidingWindowLimiter;
  maxPerMinute?: number;
  now?: number;
}

/** Null when the caller may proceed, otherwise the response to send (404 not configured, 429 too many attempts, 401 wrong or missing token). */
export function authorizeBearer(req: Request, o: BearerOptions): Response | null {
  const token = process.env[o.env] ?? "";
  if (token.length < MIN_TOKEN_LENGTH) return jsonNoStore(404, { error: "not-found" });
  const now = o.now ?? Date.now();
  const hit = o.limiter.hit(`${o.scope}:${clientIp(req)}`, o.maxPerMinute ?? 30, 60_000, now);
  if (!hit.ok) return jsonNoStore(429, { error: "too-many-attempts" }, { "retry-after": String(Math.ceil(hit.retryAfterMs / 1000)) });
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Digests of equal length, compared in constant time: neither the length nor the content of the token is revealed by timing.
  if (given && timingSafeEqual(digest(given), digest(token))) return null;
  return jsonNoStore(401, { error: "unauthorized" });
}
