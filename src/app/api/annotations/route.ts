import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { annotations, readers } from "@/lib/db/schema";
import { ensureReaderId } from "@/lib/server/reader";

const AnchorZ = z.object({ start: z.object({ b: z.string(), o: z.number().int().min(0) }), end: z.object({ b: z.string(), o: z.number().int().min(0) }), quote: z.string(), prefix: z.string().optional(), suffix: z.string().optional() });
export const AnnotationZ = z.object({
  id: z.string().min(4).max(40),
  documentId: z.string().min(1).max(80),
  kind: z.enum(["highlight", "underline", "note"]),
  color: z.enum(["yellow", "green", "blue", "pink"]).optional(),
  note: z.string().max(5000).optional(),
  anchor: AnchorZ,
  createdAt: z.number(),
  updatedAt: z.number(),
});

export async function POST(req: Request) {
  const db = getDb();
  if (!db) return Response.json({ persisted: false });
  const parsed = AnnotationZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
  const a = parsed.data;
  const readerId = await ensureReaderId();
  await db.insert(readers).values({ id: readerId }).onConflictDoNothing();
  await db
    .insert(annotations)
    .values({ id: a.id, documentId: a.documentId, readerId, kind: a.kind, color: a.color ?? null, note: a.note ?? null, anchor: a.anchor, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt) })
    .onConflictDoUpdate({ target: annotations.id, set: { color: a.color ?? null, note: a.note ?? null, anchor: a.anchor, kind: a.kind, updatedAt: new Date(a.updatedAt) }, setWhere: eq(annotations.readerId, readerId) });
  return Response.json({ persisted: true });
}
