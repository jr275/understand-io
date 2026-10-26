import { classifyUpload } from "@/lib/content/uploadKind";
import { IMPORTERS, SUPPORTED_FORMATS } from "@/lib/content/importers";
import { readFormLimited } from "@/lib/server/body";
import { ensureReaderId } from "@/lib/server/reader";
import { saveDocument } from "@/lib/server/documents";
import { importErrorResponse } from "@/lib/server/importErrors";
import { limitImports } from "@/lib/server/rateLimit";

export const maxDuration = 60;

const MAX_FILE = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const limited = await limitImports(req);
  if (limited) return limited;
  // Counted while the body streams in, so an oversized upload is refused before it is parsed into memory.
  const form = await readFormLimited(req, MAX_FILE + 64 * 1024);
  if (form === "too-large") return Response.json({ error: "That file is larger than 25 MB." }, { status: 413 });
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file received." }, { status: 400 });
  if (file.size > MAX_FILE) return Response.json({ error: "That file is larger than 25 MB." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Refuse what cannot be read before a reader is created or anything is parsed.
  const kind = classifyUpload(file.name, file.type, bytes);
  if (kind === "unsupported") return Response.json({ error: `Only ${SUPPORTED_FORMATS} files can be imported.` }, { status: 415 });
  if (kind === "binary") return Response.json({ error: `That file does not look like text. Only ${SUPPORTED_FORMATS} files can be imported.` }, { status: 415 });
  const readerId = await ensureReaderId();
  try {
    const doc = await IMPORTERS[kind].read(bytes, file.name);
    if (!doc.blocks.length) return Response.json({ error: "Nothing readable in that file." }, { status: 422 });
    const saved = await saveDocument(readerId, doc);
    return Response.json({ document: saved, persisted: saved.persisted, duplicate: saved.duplicate });
  } catch (err) {
    return importErrorResponse(err, "Could not read that file.");
  }
}
