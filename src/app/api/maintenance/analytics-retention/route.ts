import { analyticsMode } from "@/lib/server/analytics";
import { retentionStatus, runRetention } from "@/lib/server/analyticsRetention";
import { authorizeBearer, jsonNoStore } from "@/lib/server/bearerAuth";
import { SlidingWindowLimiter } from "@/lib/server/rateLimit";

/**
 * Maintenance for analytics retention, for an external scheduler or an operator. It does not exist unless `GLOSS_MAINTENANCE_TOKEN` is set to a long
 * value (at least 32 characters): without it every method answers 404, exactly as an unknown path would. With it, the caller must send
 * `Authorization: Bearer <token>`.
 *
 *   GET   what the policy is, the last run this instance knows of, and how many rows are past retention (a bounded count)
 *   POST  run the deletion now (bounded batches, idempotent, never more than one run's limits) and answer its result
 *
 * Nothing in an answer is a row, an actor or a secret. Attempts are rate limited per address.
 */
const attempts = new SlidingWindowLimiter(5000);
/** Every attempt counts, valid or not: a scheduler calls this a few times an hour, so a burst can only be a guess at the token. */
const MAX_ATTEMPTS_PER_MINUTE = 30;

const respond = jsonNoStore;
const authorize = (req: Request, now: number) => authorizeBearer(req, { env: "GLOSS_MAINTENANCE_TOKEN", scope: "m", limiter: attempts, maxPerMinute: MAX_ATTEMPTS_PER_MINUTE, now });

export async function GET(req: Request) {
  const denied = authorize(req, Date.now());
  if (denied) return denied;
  return respond(200, { mode: analyticsMode(), ...(await retentionStatus()) });
}

export async function POST(req: Request) {
  const denied = authorize(req, Date.now());
  if (denied) return denied;
  return respond(200, { mode: analyticsMode(), result: await runRetention() });
}
