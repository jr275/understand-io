import { getDocumentProxy } from "unpdf";
import type { GlossDocument } from "./types";
import { ReadError } from "./errors";
import { PDF_LIMITS } from "./limits";
import { blocksFromText } from "./text";
import { readingMinutes, slugFor } from "./slug";

/** PDF bytes → document. Paragraphs are rebuilt from line breaks and blank lines. Limits: page count, extracted text size, time. */
export async function documentFromPdf(bytes: Uint8Array, filename: string): Promise<GlossDocument> {
  let pdf: Pdf;
  try {
    pdf = await getDocumentProxy(bytes, { maxImageSize: 1_000_000 });
  } catch (err) {
    // pdf.js messages ("Invalid PDF structure", password exceptions) are not written for readers.
    throw new ReadError((err as { name?: string } | null)?.name === "PasswordException" ? "That PDF is password-protected." : "That PDF could not be opened (it may be damaged).");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (pdf.numPages > PDF_LIMITS.pages) throw new ReadError(`That PDF has ${pdf.numPages} pages; the limit is ${PDF_LIMITS.pages}. Import a shorter extract.`);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ReadError("That PDF took too long to read.")), PDF_LIMITS.ms);
    });
    return await Promise.race([readPdf(pdf, filename), timeout]);
  } catch (err) {
    if (err instanceof ReadError) throw err;
    throw new ReadError("That PDF could not be read (it may be damaged).");
  } finally {
    clearTimeout(timer);
    void pdf.loadingTask.destroy().catch(() => {}); // also stops a still-running extraction after a timeout
  }
}

type Pdf = Awaited<ReturnType<typeof getDocumentProxy>>;

/**
 * Page text, one page at a time with a yield in between. pdf.js works through promises, so unpdf's
 * `extractText` (all pages at once) never lets a timer or another request run and holds every page in
 * memory together. Each page's text is built the way unpdf builds it.
 */
async function pageTexts(pdf: Pdf, deadline: number): Promise<string[]> {
  const pages: string[] = [];
  let chars = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    if (Date.now() > deadline) throw new ReadError("That PDF took too long to read.");
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = textWithParagraphGaps(content.items);
    page.cleanup();
    chars += text.length;
    if (chars > PDF_LIMITS.textChars) throw new ReadError("That PDF holds too much text to read here. Import a shorter extract.");
    pages.push(text);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return pages;
}

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
}

/**
 * A page's text, line by line (as unpdf builds it), with a blank line wherever the vertical gap between two lines is clearly larger
 * than the page's usual line spacing: that gap is how a PDF shows a paragraph break, and the text alone does not carry it.
 */
export function textWithParagraphGaps(items: readonly unknown[]): string {
  const lines: { text: string; y: number | null }[] = [];
  let cur = "";
  let y: number | null = null;
  for (const raw of items) {
    const item = raw as TextItemLike; // pdf.js also yields marked-content items without text
    if (item.str == null) continue;
    if (y === null && item.str.trim() && item.transform) y = item.transform[5];
    cur += item.str;
    if (item.hasEOL) {
      lines.push({ text: cur, y });
      cur = "";
      y = null;
    }
  }
  if (cur) lines.push({ text: cur, y });
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1].y;
    const b = lines[i].y;
    if (a !== null && b !== null && a - b > 0) gaps.push(a - b);
  }
  gaps.sort((p, q) => p - q);
  // The usual line spacing is the lower quartile of the gaps: paragraph gaps are the larger ones, so the median would not do on a page with few lines.
  const usual = gaps.length ? gaps[Math.floor(gaps.length / 4)] : 0;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const prev = lines[i - 1]?.y;
    const here = lines[i].y;
    if (i > 0 && usual > 0 && prev != null && here != null && prev - here > usual * 1.5) out.push("");
    out.push(lines[i].text);
  }
  return out.join("\n");
}

async function readPdf(pdf: Pdf, filename: string): Promise<GlossDocument> {
  const pages = await pageTexts(pdf, Date.now() + PDF_LIMITS.ms);
  const joined = pages
    .map((p) => rebuildParagraphs(p))
    .filter(Boolean)
    .join("\n\n");
  const blocks = blocksFromText(joined);
  if (!blocks.length) throw new ReadError("No text could be read from that PDF (it may be scanned images).");
  const meta = await pdf.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
  const title = (info.Title && info.Title.trim()) || filename.replace(/\.pdf$/i, "") || "PDF";
  return {
    slug: slugFor(title),
    kind: "pdf",
    title,
    author: info.Author?.trim() || null,
    dek: null,
    year: null,
    sourceUrl: null,
    sourceLabel: filename,
    topic: "unsorted",
    minutes: readingMinutes(blocks),
    paragraphs: blocks.filter((b) => b.n).length,
    blocks,
  };
}

/** PDF text comes line by line; join lines inside a paragraph, keep blank lines as breaks. */
export function rebuildParagraphs(page: string) {
  const lines = page.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let cur = "";
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    if (/^\d+$/.test(l)) continue; // page numbers
    if (cur && /[.!?:"”]$/.test(cur) && /^[A-Z“"(]/.test(l) && cur.length > 60) {
      out.push(cur);
      cur = l;
    } else cur = cur ? `${cur.replace(/-$/, "")}${cur.endsWith("-") ? "" : " "}${l}` : l;
  }
  if (cur) out.push(cur);
  return out.join("\n\n");
}
