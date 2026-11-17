import { CHAT_MODEL } from "@/lib/ai/provider";
import { sharedStoreConfigured } from "@/lib/server/aiStore";
import { authorizeBearer, jsonNoStore } from "@/lib/server/bearerAuth";
import { DEFAULT_STORAGE_LIMIT_MB, STORAGE_HIGH, STORAGE_WATCH, probe, whole } from "@/lib/server/healthProbe";
import { SlidingWindowLimiter, clientIp } from "@/lib/server/rateLimit";

/**
 * Two checks, deliberately apart.
 *
 * LIVENESS (`GET /api/health`) says the process is up and which commit is live. It touches no database, no store and no provider, whatever the request
 * carries, so anybody may call it and nothing it does can wake the database or spend compute hours. Uptime monitors and deploy checks use it.
 *
 * READINESS (`GET /api/health/ready`) reads the database, the AI ledger and the storage size. It exists only when `GLOSS_HEALTH_TOKEN` (32+ characters)
 * is set and answers only a caller that sends `Authorization: Bearer <token>`; everyone else gets 404 (not configured), 401 or 429 without any database
 * work. A caller that is allowed gets a bounded reading (see `healthProbe.ts`: one at a time, at most one per 10 seconds, an 8 second ceiling), a healthy
 * reading reused for 15 minutes, and `?fresh=1` to skip only that reuse. 503 when the database is down; with `?strict=1` also when a reason is present.
 * The answer holds no secret and no amount of money.
 */
const ERROR_RATE = 0.5;
const MIN_ERRORS = 5;

const authAttempts = new SlidingWindowLimiter(5000);
const livenessCalls = new SlidingWindowLimiter(5000);

/** Calls per minute and address that liveness answers; `off` or 0 disables. Only a guard on function invocations: liveness costs no database work. */
const livenessLimit = () => {
  const raw = process.env.GLOSS_HEALTH_RATE_PER_MIN?.trim().toLowerCase();
  if (raw === "off" || raw === "0") return null;
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : 600;
};

export function resetHealthLimits() {
  authAttempts.clear();
  livenessCalls.clear();
}

/** Only an exact, single `fresh=1` counts. Repeated, mixed-case, array-style or valued-otherwise parameters are plain noise. */
const flag = (params: URLSearchParams, name: string) => {
  const all = params.getAll(name);
  return all.length === 1 && all[0] === "1";
};

export function liveness(req: Request, now: number = Date.now()): Response {
  const max = livenessLimit();
  if (max !== null) {
    const hit = livenessCalls.hit(`live:${clientIp(req)}`, max, 60_000, now);
    if (!hit.ok) return jsonNoStore(429, { error: "too-many-requests" }, { "retry-after": String(Math.ceil(hit.retryAfterMs / 1000)) });
  }
  return jsonNoStore(200, {
    status: "ok",
    check: "liveness",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    region: process.env.VERCEL_REGION ?? null,
    time: new Date(now).toISOString(),
  });
}

export async function readiness(req: Request, now: number = Date.now()): Promise<Response> {
  const denied = authorizeBearer(req, { env: "GLOSS_HEALTH_TOKEN", scope: "ready", limiter: authAttempts, maxPerMinute: 30, now });
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const strict = flag(params, "strict");
  const fresh = flag(params, "fresh");
  const reasons: string[] = [];
  const warnings: string[] = [];
  const configured = !!process.env.DATABASE_URL;
  let db: "ok" | "down" | "not-configured" = configured ? "ok" : "not-configured";
  let budget: "ok" | "low" | "exhausted" | "unknown" = "unknown";
  let errorsLastHour = 0;
  let requestsLastHour = 0;
  let storage: { usedMb: number; limitMb: number; percent: number; level: "ok" | "watch" | "high" } | null = null;
  let cached = false;
  let checkedAt: string | null = null;

  if (configured) {
    try {
      const r = await probe(now, fresh);
      cached = r.cached;
      checkedAt = new Date(r.probe.at).toISOString();
      budget = r.probe.budget;
      errorsLastHour = r.probe.errorsLastHour;
      requestsLastHour = r.probe.requestsLastHour;
      if (r.probe.storageBytes !== null) {
        const limitMb = whole("GLOSS_DB_STORAGE_LIMIT_MB", DEFAULT_STORAGE_LIMIT_MB) || DEFAULT_STORAGE_LIMIT_MB;
        const usedMb = r.probe.storageBytes / 1_048_576;
        const ratio = usedMb / limitMb;
        const level = ratio >= STORAGE_HIGH ? "high" : ratio >= STORAGE_WATCH ? "watch" : "ok";
        storage = { usedMb: Math.round(usedMb * 10) / 10, limitMb, percent: Math.round(ratio * 1000) / 10, level };
        if (level === "high") reasons.push("db-storage-85");
        else if (level === "watch") warnings.push("db-storage-70");
      }
    } catch {
      db = "down";
      reasons.push("database-down");
    }
  }
  if (budget === "exhausted") reasons.push("ai-budget-exhausted");
  if (errorsLastHour >= MIN_ERRORS && errorsLastHour >= requestsLastHour * ERROR_RATE) reasons.push("ai-failing");

  const status = db === "down" ? "down" : reasons.length ? "degraded" : "ok";
  const httpStatus = status === "down" || (status === "degraded" && strict) ? 503 : 200;
  return jsonNoStore(httpStatus, {
    status,
    check: "readiness",
    reasons,
    warnings,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    region: process.env.VERCEL_REGION ?? null,
    time: new Date().toISOString(),
    database: db,
    storage,
    checked: { at: checkedAt, cached },
    ai: { configured: !!process.env.TOGETHER_API_KEY, model: CHAT_MODEL, budget, errorsLastHour, requestsLastHour, allowancesShared: sharedStoreConfigured() },
  });
}
