import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { readers, readingProgress } from "@/lib/db/schema";
import { ensureReaderId } from "@/lib/server/reader";

const Body = z.object({ documentId: z.string().min(1).max(80), blockId: z.string().optional(), ratio: z.number().min(0).max(1), finished: z.boolean().optional(), updatedAt: z.number() });

export async function PUT(req: Request) {
  const db = getDb();
  if (!db) return Response.json({ persisted: false });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
  const p = parsed.data;
  const readerId = await ensureReaderId();
  await db.insert(readers).values({ id: readerId }).onConflictDoNothing();
  await db
    .insert(readingProgress)
    .values({ documentId: p.documentId, readerId, blockId: p.blockId ?? null, ratio: p.ratio, finished: p.finished ? 1 : 0, updatedAt: new Date(p.updatedAt) })
    .onConflictDoUpdate({ target: [readingProgress.documentId, readingProgress.readerId], set: { blockId: p.blockId ?? null, ratio: p.ratio, finished: p.finished ? 1 : 0, updatedAt: new Date(p.updatedAt) } });
  return Response.json({ persisted: true });
}
