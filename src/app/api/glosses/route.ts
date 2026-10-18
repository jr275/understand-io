import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { glosses, readers } from "@/lib/db/schema";
import { GlossZ } from "@/lib/anchors/schema";
import { ensureReaderId } from "@/lib/server/reader";
import { canAttachTo } from "@/lib/server/documents";
import { guarded, readJson, readerKeyOf } from "../annotations/_guard";

export async function POST(req: Request) {
  const db = getDb();
  if (!db) return Response.json({ persisted: false });
  const parsed = GlossZ.safeParse(await readJson(req));
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
  const g = parsed.data;
  return guarded("gloss upsert", async () => {
    const readerId = await ensureReaderId();
    await db.insert(readers).values({ id: readerId }).onConflictDoNothing();
    if (!(await canAttachTo(db, readerId, g.documentId))) return Response.json({ error: "unknown-document" }, { status: 404 });
    const written = await db
      .insert(glosses)
      .values({ id: g.id, documentId: g.documentId, readerId, action: g.action, anchor: g.anchor, turns: g.turns, model: g.model ?? null, usage: g.usage ?? null, result: g.result ?? null, createdAt: new Date(g.createdAt) })
      .onConflictDoUpdate({ target: glosses.id, set: { turns: g.turns, model: g.model ?? null, usage: g.usage ?? null, result: g.result ?? null }, setWhere: eq(glosses.readerId, readerId) })
      .returning({ id: glosses.id });
    // Nothing written: the id belongs to another reader. Never overwrite it and never claim success.
    if (!written.length) return Response.json({ error: "id-conflict" }, { status: 409 });
    return Response.json({ persisted: true, readerKey: readerKeyOf(readerId) });
  });
}
