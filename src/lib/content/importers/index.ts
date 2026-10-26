import { decodeBytes } from "../charset";
import { classifyUpload, type UploadKind } from "../uploadKind";
import { documentFromText } from "../text";
import type { GlossDocument } from "../types";

/** What a file kind is called to the reader, in the order the picker lists it. */
export const SUPPORTED_FORMATS = "PDF, text (.txt), markdown (.md), Word (.docx), EPUB and HTML";

export type ReadableKind = Exclude<UploadKind, "unsupported" | "binary">;

/**
 * One importer per readable kind. Each takes the bytes of a file and either returns a document or throws a `ReadError` whose message is
 * meant for the reader. A new format is one entry here plus its test: the route, the queue and the Library need no change.
 */
export interface Importer {
  /** Heavy parsers are loaded only when a file of their kind arrives. */
  read(bytes: Uint8Array, fileName: string): Promise<GlossDocument>;
}

export const IMPORTERS: Record<ReadableKind, Importer> = {
  pdf: {
    async read(bytes, fileName) {
      const { documentFromPdf } = await import("../pdf");
      return documentFromPdf(bytes, fileName);
    },
  },
  text: {
    async read(bytes, fileName) {
      const text = decodeBytes(bytes);
      // A leading heading in the file names the text; otherwise the file name does.
      const doc = /^\s*#\s+\S/.test(text) ? documentFromText(text) : documentFromText(text, fileName.replace(/\.(txt|md|markdown)$/i, ""));
      doc.sourceLabel = fileName;
      return doc;
    },
  },
  html: {
    async read(bytes, fileName) {
      const { documentFromHtmlFile } = await import("./htmlFile");
      return documentFromHtmlFile(bytes, fileName);
    },
  },
  docx: {
    async read(bytes, fileName) {
      const { documentFromDocx } = await import("./docx");
      return documentFromDocx(bytes, fileName);
    },
  },
  epub: {
    async read(bytes, fileName) {
      const { documentFromEpub } = await import("./epub");
      return documentFromEpub(bytes, fileName);
    },
  },
};

/** Classify a file and read it with its importer. Returns the refusal for a kind that is not readable. */
export async function readUpload(fileName: string, type: string, bytes: Uint8Array): Promise<{ ok: true; doc: GlossDocument } | { ok: false; kind: "unsupported" | "binary" }> {
  const kind = classifyUpload(fileName, type, bytes);
  if (kind === "unsupported" || kind === "binary") return { ok: false, kind };
  return { ok: true, doc: await IMPORTERS[kind].read(bytes, fileName) };
}
