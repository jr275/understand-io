import { z } from "zod";
import { documentFromText } from "@/lib/content/text";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";

const Body = z.object({ text: z.string().min(1).max(2_000_000), title: z.string().max(200).optional() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Nothing to read." }, { status: 400 });
  const readerId = await ensureReaderId();
  const doc = documentFromText(parsed.data.text, parsed.data.title);
  if (!doc.blocks.length) return Response.json({ error: "Nothing to read." }, { status: 422 });
  const saved = await saveDocument(readerId, doc);
  return Response.json({ document: saved, persisted: saved.persisted });
}
