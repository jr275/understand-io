import { and, eq, lte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { annotations } from "@/lib/db/schema";
import { AnnotationPatchZ, IdZ } from "@/lib/anchors/schema";
import { getReaderId } from "@/lib/server/reader";
import { guarded, readJson } from "../_guard";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const readerId = await getReaderId();
  if (!db || !readerId) return Response.json({ persisted: false });
  const parsed = AnnotationPatchZ.safeParse(await readJson(req));
  if (!parsed.success || !IdZ.safeParse(id).success) return Response.json({ error: "bad-request" }, { status: 400 });
  const p = parsed.data;
  // The client's clock decides the order (older clients send none: then it is "now"), so a PATCH that arrives late is a no-op.
  const updatedAt = p.updatedAt !== undefined ? new Date(p.updatedAt) : new Date();
  return guarded("annotation patch", async () => {
    const written = await db
      .update(annotations)
      .set({ ...(p.color ? { color: p.color } : {}), ...(p.note !== undefined ? { note: p.note } : {}), ...(p.kind ? { kind: p.kind } : {}), updatedAt })
      .where(and(eq(annotations.id, id), eq(annotations.readerId, readerId), lte(annotations.updatedAt, updatedAt)))
      .returning({ id: annotations.id });
    if (written.length) return Response.json({ persisted: true, applied: true });
    const [row] = await db.select({ id: annotations.id }).from(annotations).where(and(eq(annotations.id, id), eq(annotations.readerId, readerId))).limit(1);
    // No such row for this reader: the client falls back to a full POST. Otherwise the stored copy is newer.
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({ persisted: true, applied: false });
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const readerId = await getReaderId();
  if (!db || !readerId) return Response.json({ persisted: false });
  return guarded("annotation delete", async () => {
    await db.delete(annotations).where(and(eq(annotations.id, id), eq(annotations.readerId, readerId)));
    return Response.json({ persisted: true });
  });
}
