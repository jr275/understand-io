import { and, eq, lte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { annotations, readers } from "@/lib/db/schema";
import { AnnotationZ } from "@/lib/anchors/schema";
import { ensureReaderId } from "@/lib/server/reader";
import { guarded, readJson, readerKeyOf } from "./_guard";

export async function POST(req: Request) {
  const db = getDb();
  if (!db) return Response.json({ persisted: false });
  const parsed = AnnotationZ.safeParse(await readJson(req));
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
  const a = parsed.data;
  return guarded("annotation upsert", async () => {
    const readerId = await ensureReaderId();
    await db.insert(readers).values({ id: readerId }).onConflictDoNothing();
    const updatedAt = new Date(a.updatedAt);
    // Last write wins on the client's clock, and only on the reader's own row.
    const written = await db
      .insert(annotations)
      .values({ id: a.id, documentId: a.documentId, readerId, kind: a.kind, color: a.color ?? null, note: a.note ?? null, anchor: a.anchor, createdAt: new Date(a.createdAt), updatedAt })
      .onConflictDoUpdate({ target: annotations.id, set: { color: a.color ?? null, note: a.note ?? null, anchor: a.anchor, kind: a.kind, updatedAt }, setWhere: and(eq(annotations.readerId, readerId), lte(annotations.updatedAt, updatedAt)) })
      .returning({ id: annotations.id });
    if (written.length) return Response.json({ persisted: true, applied: true, readerKey: readerKeyOf(readerId) });
    // Refused: either the id belongs to another reader (never overwrite it, never claim success) or the stored copy is newer.
    const [row] = await db.select({ readerId: annotations.readerId }).from(annotations).where(eq(annotations.id, a.id)).limit(1);
    if (row && row.readerId !== readerId) return Response.json({ error: "id-conflict" }, { status: 409 });
    return Response.json({ persisted: true, applied: false, readerKey: readerKeyOf(readerId) });
  });
}
