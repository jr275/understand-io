import { z } from "zod";
import { documentFromText } from "@/lib/content/text";
import { readJsonLimited } from "@/lib/server/body";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";
import { importErrorResponse } from "@/lib/server/importErrors";

const MAX_CHARS = 2_000_000;
const Body = z.object({ text: z.string(), title: z.string().max(200).optional() });

export async function POST(req: Request) {
  // 4 bytes per character at most, plus the envelope.
  const json = await readJsonLimited(req, 2_000_000 * 4 + 8192);
  if (json === "too-large") return Response.json({ error: "That text is too long." }, { status: 413 });
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: "That request could not be read: send JSON like {\"text\": \"…\"}." }, { status: 400 });
  if (parsed.data.text.length > MAX_CHARS) return Response.json({ error: "That text is longer than 2 million characters." }, { status: 413 });
  if (parsed.data.text.includes("\u0000")) return Response.json({ error: "That text contains characters that cannot be stored (it may be a binary file)." }, { status: 400 });
  if (!parsed.data.text.trim()) return Response.json({ error: "Nothing to read." }, { status: 422 });
  const readerId = await ensureReaderId();
  const doc = documentFromText(parsed.data.text, parsed.data.title);
  if (!doc.blocks.length) return Response.json({ error: "Nothing to read." }, { status: 422 });
  try {
    const saved = await saveDocument(readerId, doc);
    return Response.json({ document: saved, persisted: saved.persisted });
  } catch (err) {
    return importErrorResponse(err, "Could not save that text.");
  }
}
