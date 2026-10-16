import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { glosses, readers } from "@/lib/db/schema";
import { ensureReaderId } from "@/lib/server/reader";

const GlossZ = z.object({
  id: z.string().min(4).max(40),
  documentId: z.string().min(1).max(80),
  action: z.string().max(20),
  anchor: z.object({ start: z.object({ b: z.string(), o: z.number() }), end: z.object({ b: z.string(), o: z.number() }), quote: z.string(), prefix: z.string().optional(), suffix: z.string().optional() }).nullable(),
  turns: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20000) })).max(40),
  model: z.string().optional(),
  usage: z.object({ input: z.number(), output: z.number(), cost: z.number().optional() }).nullable().optional(),
  createdAt: z.number(),
});

export async function POST(req: Request) {
  const db = getDb();
  if (!db) return Response.json({ persisted: false });
  const parsed = GlossZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
  const g = parsed.data;
  const readerId = await ensureReaderId();
  await db.insert(readers).values({ id: readerId }).onConflictDoNothing();
  await db
    .insert(glosses)
    .values({ id: g.id, documentId: g.documentId, readerId, action: g.action, anchor: g.anchor, turns: g.turns, model: g.model ?? null, usage: g.usage ?? null, createdAt: new Date(g.createdAt) })
    .onConflictDoUpdate({ target: glosses.id, set: { turns: g.turns, model: g.model ?? null, usage: g.usage ?? null } });
  return Response.json({ persisted: true });
}
