import { liveness } from "@/lib/server/readiness";

export const dynamic = "force-dynamic";

/**
 * LIVENESS. The process is up and this is the commit it runs. It never touches the database, the store or the AI provider, and nothing in the request
 * (query string, headers, method) changes that, so it is safe for anyone to call and cannot wake a sleeping database. See `readiness.ts` for the whole
 * contract, and `/api/health/ready` for the database, AI and storage readings (token only).
 */
export function GET(req: Request) {
  return liveness(req);
}
