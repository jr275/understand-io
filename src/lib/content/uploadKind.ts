export type UploadKind = "pdf" | "text" | "unsupported" | "binary";

const TEXT_EXT = /\.(txt|md|markdown)$/i;

/**
 * What an uploaded file is, from its name, its declared type and its first bytes. Only PDFs and plain text or markdown are read:
 * an image, an archive or any other binary renamed or mislabelled as text must not be turned into a "document" of garbage.
 */
export function classifyUpload(name: string, type: string, head: Uint8Array): UploadKind {
  if (/\.pdf$/i.test(name) || /pdf/i.test(type)) return "pdf";
  const textual = TEXT_EXT.test(name) || /^text\/(plain|markdown)$/i.test(type);
  if (!textual) return "unsupported";
  // Text has no NUL bytes; binary formats almost always have one early on.
  for (let i = 0; i < Math.min(head.length, 8192); i++) if (head[i] === 0) return "binary";
  return "text";
}
