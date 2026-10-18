import { getDb } from "@/lib/db/client";
import { readers, readingProgress } from "@/lib/db/schema";
import { ProgressZ } from "@/lib/anchors/schema";
import { ensureReaderId } from "@/lib/server/reader";
import { canAttachTo } from "@/lib/server/documents";
import { guarded, readJson } from "../annotations/_guard";

export async function PUT(req: Request) {
  const db = getDb();
  if (!db) return Response.json({ persisted: false });
  const parsed = ProgressZ.safeParse(await readJson(req));
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
  const p = parsed.data;
  return guarded("progress upsert", async () => {
    const readerId = await ensureReaderId();
    await db.insert(readers).values({ id: readerId }).onConflictDoNothing();
    if (!(await canAttachTo(db, readerId, p.documentId))) return Response.json({ error: "unknown-document" }, { status: 404 });
    await db
      .insert(readingProgress)
      .values({ documentId: p.documentId, readerId, blockId: p.blockId ?? null, ratio: p.ratio, finished: p.finished ? 1 : 0, updatedAt: new Date(p.updatedAt) })
      .onConflictDoUpdate({ target: [readingProgress.documentId, readingProgress.readerId], set: { blockId: p.blockId ?? null, ratio: p.ratio, finished: p.finished ? 1 : 0, updatedAt: new Date(p.updatedAt) } });
    return Response.json({ persisted: true });
  });
}
