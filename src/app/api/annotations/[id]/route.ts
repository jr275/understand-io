import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { annotations } from "@/lib/db/schema";
import { getReaderId } from "@/lib/server/reader";

const Patch = z.object({ color: z.enum(["yellow", "green", "blue", "pink"]).optional(), note: z.string().max(5000).optional(), kind: z.enum(["highlight", "underline", "note"]).optional() });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const readerId = await getReaderId();
  if (!db || !readerId) return Response.json({ persisted: false });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
  const p = parsed.data;
  await db
    .update(annotations)
    .set({ ...(p.color ? { color: p.color } : {}), ...(p.note !== undefined ? { note: p.note } : {}), ...(p.kind ? { kind: p.kind } : {}), updatedAt: new Date() })
    .where(and(eq(annotations.id, id), eq(annotations.readerId, readerId)));
  return Response.json({ persisted: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const readerId = await getReaderId();
  if (!db || !readerId) return Response.json({ persisted: false });
  await db.delete(annotations).where(and(eq(annotations.id, id), eq(annotations.readerId, readerId)));
  return Response.json({ persisted: true });
}
