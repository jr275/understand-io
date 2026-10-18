import { getDb } from "@/lib/db/client";
import { readers } from "@/lib/db/schema";
import { ensureReaderId } from "@/lib/server/reader";
import { guarded, readerKeyOf } from "../annotations/_guard";

/**
 * Gives this browser its anonymous reader (cookie and row) before anything is saved. Without it, the first two requests of a
 * new visitor (a highlight and the reading position, say) can arrive together with no cookie yet, and each mints its own
 * reader: the browser keeps the last cookie and what the first one saved is stranded under another reader.
 * Idempotent: with a valid cookie it only answers the reader's key. Without a database nothing is stored, so no cookie is set.
 */
export async function POST() {
  const db = getDb();
  if (!db) return Response.json({ persisted: false });
  return guarded("reader bootstrap", async () => {
    const readerId = await ensureReaderId();
    await db.insert(readers).values({ id: readerId }).onConflictDoNothing();
    return Response.json({ persisted: true, readerKey: readerKeyOf(readerId) });
  });
}
