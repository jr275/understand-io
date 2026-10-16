import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { annotations, glosses, readingProgress } from "@/lib/db/schema";
import { getReaderId } from "@/lib/server/reader";

/** Everything the reader needs for one document: annotations, glosses, progress. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const readerId = await getReaderId();
  if (!db || !readerId) return Response.json({ annotations: [], glosses: [], progress: null, persisted: false });
  const [a, g, p] = await Promise.all([
    db.select().from(annotations).where(and(eq(annotations.documentId, id), eq(annotations.readerId, readerId))),
    db.select().from(glosses).where(and(eq(glosses.documentId, id), eq(glosses.readerId, readerId))),
    db.select().from(readingProgress).where(and(eq(readingProgress.documentId, id), eq(readingProgress.readerId, readerId))).limit(1),
  ]);
  return Response.json({
    persisted: true,
    annotations: a.map((r) => ({ id: r.id, documentId: r.documentId, kind: r.kind, color: r.color ?? undefined, note: r.note ?? undefined, anchor: r.anchor, createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime() })),
    glosses: g.map((r) => ({ id: r.id, documentId: r.documentId, action: r.action, anchor: r.anchor, turns: r.turns, model: r.model ?? undefined, usage: r.usage ?? undefined, createdAt: r.createdAt.getTime() })),
    progress: p[0] ? { documentId: id, blockId: p[0].blockId ?? undefined, ratio: p[0].ratio, finished: !!p[0].finished, updatedAt: p[0].updatedAt.getTime() } : null,
  });
}
