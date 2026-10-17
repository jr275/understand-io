import { documentFromText } from "@/lib/content/text";
import { readFormLimited } from "@/lib/server/body";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";
import { importErrorResponse } from "@/lib/server/importErrors";

export const maxDuration = 60;

const MAX_FILE = 25 * 1024 * 1024;

export async function POST(req: Request) {
  // Counted while the body streams in, so an oversized upload is refused before it is parsed into memory.
  const form = await readFormLimited(req, MAX_FILE + 64 * 1024);
  if (form === "too-large") return Response.json({ error: "That file is larger than 25 MB." }, { status: 413 });
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file received." }, { status: 400 });
  if (file.size > MAX_FILE) return Response.json({ error: "That file is larger than 25 MB." }, { status: 413 });
  const readerId = await ensureReaderId();
  try {
    const isPdf = file.type.includes("pdf") || /\.pdf$/i.test(file.name);
    let doc;
    if (isPdf) {
      const { documentFromPdf } = await import("@/lib/content/pdf");
      doc = await documentFromPdf(new Uint8Array(await file.arrayBuffer()), file.name);
    } else {
      const text = await file.text();
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
