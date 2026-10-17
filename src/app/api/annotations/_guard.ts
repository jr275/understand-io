import { createHash } from "node:crypto";
import { describeDbError, isConnectionError } from "@/lib/server/dbErrors";

/** Largest JSON body the annotation, gloss and progress routes read (a gloss may carry 40 turns of 20 000 characters). */
const MAX_BODY = 1_200_000;

/** Opaque, stable per reader, not reversible to the reader id: lets the client notice that the cookie now names another reader (sign-in). */
export const readerKeyOf = (readerId: string) => createHash("sha256").update(`reader-key:${readerId}`).digest("hex").slice(0, 16);

export const unavailable = () => Response.json({ error: "database-unavailable" }, { status: 503 });

/**
 * Read and parse a JSON body, answering null for a missing, malformed or oversized one. The size is checked
 * on the text actually read, so a lying or absent content-length does not matter.
 */
export async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return null;
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Run a route body; a connection-level database failure becomes `onOutage()` (a 503 for mutations so the
 * client keeps its tombstones and retries, a harmless `persisted:false` for reads) instead of an uncaught throw.
 * Any other error is rethrown unchanged.
 */
export async function guarded(label: string, run: () => Promise<Response>, onOutage: () => Response = unavailable): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    console.warn(`gloss: ${label}: database unavailable (${describeDbError(err)})`);
    return onOutage();
  }
}
