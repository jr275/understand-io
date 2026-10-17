import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { annotations, documents, glosses, readingProgress } from "@/lib/db/schema";
import { getReaderId } from "@/lib/server/reader";
import { guarded } from "@/app/api/annotations/_guard";

const Patch = z.object({ topic: z.string().max(40).optional(), favourite: z.boolean().optional(), title: z.string().min(1).max(300).optional() });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const readerId = await getReaderId();
  if (!db || !readerId) return Response.json({ persisted: false });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
  const p = parsed.data;
  return guarded("document PATCH", async () => {
    await db
      .update(documents)
      .set({ ...(p.topic ? { topic: p.topic } : {}), ...(p.title ? { title: p.title } : {}), ...(p.favourite !== undefined ? { favourite: p.favourite ? 1 : 0 } : {}), updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.readerId, readerId)));
    return Response.json({ persisted: true });
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const readerId = await getReaderId();
  if (!db || !readerId) return Response.json({ persisted: false });
  return guarded("document DELETE", async () => {
    await db.transaction(async (tx) => {
      await tx.delete(annotations).where(and(eq(annotations.documentId, id), eq(annotations.readerId, readerId)));
      await tx.delete(glosses).where(and(eq(glosses.documentId, id), eq(glosses.readerId, readerId)));
      await tx.delete(readingProgress).where(and(eq(readingProgress.documentId, id), eq(readingProgress.readerId, readerId)));
      await tx.delete(documents).where(and(eq(documents.id, id), eq(documents.readerId, readerId)));
    });
    return Response.json({ persisted: true });
  });
}
