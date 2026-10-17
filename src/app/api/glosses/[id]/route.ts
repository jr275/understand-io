import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { glosses } from "@/lib/db/schema";
import { getReaderId } from "@/lib/server/reader";
import { guarded } from "../../annotations/_guard";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const readerId = await getReaderId();
  if (!db || !readerId) return Response.json({ persisted: false });
  return guarded("gloss delete", async () => {
    await db.delete(glosses).where(and(eq(glosses.id, id), eq(glosses.readerId, readerId)));
    return Response.json({ persisted: true });
  });
}
