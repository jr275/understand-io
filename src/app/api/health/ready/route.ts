import { readiness } from "@/lib/server/readiness";

export const dynamic = "force-dynamic";

/** READINESS: database, AI ledger and storage. Off unless `GLOSS_HEALTH_TOKEN` is set; token only. See `src/lib/server/readiness.ts`. */
export function GET(req: Request) {
  return readiness(req);
}
