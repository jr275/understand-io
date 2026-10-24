export type UploadKind = "pdf" | "text" | "html" | "docx" | "epub" | "unsupported" | "binary";

const TEXT_EXT = /\.(txt|md|markdown)$/i;

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * What an uploaded file is, from its name, its declared type and its first bytes. Only PDFs, Word and EPUB files, saved web pages and
 * plain text or markdown are read: an image, an archive or any other binary renamed or mislabelled as one of them must not be turned
 * into a "document" of garbage. A saved web page is read as content (its article), never opened or run.
 */
export function classifyUpload(name: string, type: string, head: Uint8Array): UploadKind {
  if (/\.pdf$/i.test(name) || /pdf/i.test(type)) return "pdf";
  if (/\.docx$/i.test(name) || type === DOCX_TYPE) return "docx";
  if (/\.epub$/i.test(name) || /^application\/epub\+zip$/i.test(type)) return "epub";
  const web = /\.(html?|xhtml)$/i.test(name) || /^(text\/html|application\/xhtml\+xml)$/i.test(type);
  const textual = TEXT_EXT.test(name) || /^text\/(plain|markdown)$/i.test(type);
  if (!web && !textual) return "unsupported";
  // Text has no NUL bytes; binary formats almost always have one early on.
  for (let i = 0; i < Math.min(head.length, 8192); i++) if (head[i] === 0) return "binary";
  return web ? "html" : "text";
}

export type FetchedKind = "pdf" | "html" | "text" | "unsupported";

const hasPrefix = (head: Uint8Array, s: string) => s.split("").every((c, i) => head[i] === c.charCodeAt(0));

/**
 * What a fetched link points to. The declared type is not trusted alone: servers send PDFs as application/octet-stream or as
 * text/html error pages, so the first bytes and the file extension count too. Only web pages, PDFs and plain text or markdown are read.
 */
export function classifyFetched(contentType: string, pathname: string, head: Uint8Array): FetchedKind {
  const type = contentType.toLowerCase().split(";")[0].trim();
  if (hasPrefix(head, "%PDF-")) return "pdf";
  if (type.includes("pdf")) return "pdf";
  if (type === "text/html" || type === "application/xhtml+xml") return "html";
  if (type === "text/plain" || type === "text/markdown") return /\.(md|markdown)$/i.test(pathname) || !/\.(html?|php|aspx?)$/i.test(pathname) ? "text" : "html";
  if (/\.pdf$/i.test(pathname) && (type === "" || type === "application/octet-stream" || type === "binary/octet-stream")) return "pdf";
  if (type === "" || type === "application/octet-stream") {
    // No usable declared type: a page that starts like markup is a page; text without NUL bytes is text; anything else is not readable.
    const sample = new TextDecoder("utf-8", { fatal: false }).decode(head.slice(0, 2048)).trimStart().toLowerCase();
    if (sample.startsWith("<!doctype html") || sample.startsWith("<html") || sample.startsWith("<head") || sample.startsWith("<body")) return "html";
    for (let i = 0; i < Math.min(head.length, 8192); i++) if (head[i] === 0) return "unsupported";
    return head.length ? "text" : "unsupported";
  }
  return "unsupported";
}
