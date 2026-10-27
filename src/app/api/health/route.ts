import { budgetLimits } from "@/lib/ai/budget";
import { CHAT_MODEL } from "@/lib/ai/provider";
import { aiStore, sharedStoreConfigured } from "@/lib/server/aiStore";

export const dynamic = "force-dynamic";

/** The database must answer within this, or it counts as down (a hung connection is an outage for the reader too). */
const DB_TIMEOUT_MS = 3000;
/** The shared AI is flagged when most of the last hour's requests failed. */
const ERROR_RATE = 0.5;
const MIN_ERRORS = 5;

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error("timeout")), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * A check an uptime monitor can poll. It reads the database and the AI ledger and never calls the AI provider, so polling it costs nothing.
 * It says which commit is live, whether the database answers, and whether the shared AI is healthy, paused by its budget or failing; it holds
 * no secret and no amount of money. 503 when the database is down; with `?strict=1` also when the AI is failing or paused, so a monitor can alert on it.
 */
export async function GET(req: Request) {
  const strict = new URL(req.url).searchParams.get("strict") === "1";
  const reasons: string[] = [];
  const configured = !!process.env.DATABASE_URL;
  let db: "ok" | "down" | "not-configured" = configured ? "ok" : "not-configured";
  let budget: "ok" | "low" | "exhausted" | "unknown" = "unknown";
  let errorsLastHour = 0;
  let requestsLastHour = 0;

  if (configured) {
    try {
      const store = aiStore();
      await within(store.ping(), DB_TIMEOUT_MS);
      const u = await within(store.usage(Date.now()), DB_TIMEOUT_MS);
      const daily = budgetLimits().dailyMicro;
      const used = u.day.spentMicro + u.reservedMicro;
      budget = daily <= 0 || used >= daily ? "exhausted" : used >= daily * 0.8 ? "low" : "ok";
      errorsLastHour = u.lastHour.errors;
      requestsLastHour = u.lastHour.requests;
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
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
      region: process.env.VERCEL_REGION ?? null,
      time: new Date().toISOString(),
      database: db,
      ai: { configured: !!process.env.TOGETHER_API_KEY, model: CHAT_MODEL, budget, errorsLastHour, requestsLastHour, allowancesShared: sharedStoreConfigured() },
    },
    { status: httpStatus, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
}
