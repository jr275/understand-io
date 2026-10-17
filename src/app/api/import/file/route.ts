import { documentFromText } from "@/lib/content/text";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";

export const maxDuration = 60;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file received." }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return Response.json({ error: "That file is larger than 25 MB." }, { status: 413 });
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
    return Response.json({ error: err instanceof Error ? err.message : "Could not read that file." }, { status: 422 });
  }
}
