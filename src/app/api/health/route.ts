import { CHAT_MODEL } from "@/lib/ai/provider";
import { sharedStoreConfigured } from "@/lib/server/aiStore";
import { DEFAULT_STORAGE_LIMIT_MB, STORAGE_HIGH, STORAGE_WATCH, probe, whole } from "@/lib/server/healthProbe";

export const dynamic = "force-dynamic";

/** The shared AI is flagged when most of the last hour's requests failed. */
const ERROR_RATE = 0.5;
const MIN_ERRORS = 5;


/**
 * A check an uptime monitor can poll. It reads the database and the AI ledger and never calls the AI provider, so polling it costs nothing.
 * It says which commit is live, whether the database answers, whether it is filling up (70% a warning, 85% a reason), and whether the shared AI is
 * healthy, paused by its budget or failing; it holds no secret and no amount of money. 503 when the database is down; with `?strict=1` also when
 * a reason is present, so a monitor can alert on it. A healthy reading is reused for 15 minutes (`GLOSS_HEALTH_DB_CACHE_SECONDS`, `?fresh=1` to skip).
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const strict = params.get("strict") === "1";
  const fresh = params.get("fresh") === "1";
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
      const r = await probe(Date.now(), fresh);
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
  return Response.json(
    {
      status,
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
    },
    { status: httpStatus, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
}
