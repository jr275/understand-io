import { classifyUpload } from "@/lib/content/uploadKind";
import { documentFromText } from "@/lib/content/text";
import { readFormLimited } from "@/lib/server/body";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";
import { importErrorResponse } from "@/lib/server/importErrors";
import { limitImports } from "@/lib/server/rateLimit";

export const maxDuration = 60;

const MAX_FILE = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const limited = limitImports(req);
  if (limited) return limited;
  // Counted while the body streams in, so an oversized upload is refused before it is parsed into memory.
  const form = await readFormLimited(req, MAX_FILE + 64 * 1024);
  if (form === "too-large") return Response.json({ error: "That file is larger than 25 MB." }, { status: 413 });
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file received." }, { status: 400 });
  if (file.size > MAX_FILE) return Response.json({ error: "That file is larger than 25 MB." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = classifyUpload(file.name, file.type, bytes);
  if (kind === "unsupported") return Response.json({ error: "Only PDF, text (.txt) and markdown (.md) files can be imported." }, { status: 415 });
  if (kind === "binary") return Response.json({ error: "That file does not look like text. Only PDF, text and markdown files can be imported." }, { status: 415 });
  const readerId = await ensureReaderId();
  try {
    let doc;
    if (kind === "pdf") {
      const { documentFromPdf } = await import("@/lib/content/pdf");
      doc = await documentFromPdf(bytes, file.name);
    } else {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      // A leading heading in the file names the text; otherwise the file name does.
      const fromHeading = documentFromText(text);
      doc = /^\s*#\s+\S/.test(text) ? fromHeading : documentFromText(text, file.name.replace(/\.(txt|md|markdown)$/i, ""));
      doc.sourceLabel = file.name;
    }
    if (!doc.blocks.length) return Response.json({ error: "Nothing readable in that file." }, { status: 422 });
    const saved = await saveDocument(readerId, doc);
    return Response.json({ document: saved, persisted: saved.persisted });
  } catch (err) {
    return importErrorResponse(err, "Could not read that file.");
  }
}
