import { extractText, getDocumentProxy } from "unpdf";
import type { GlossDocument } from "./types";
import { blocksFromText } from "./text";
import { readingMinutes, slugFor } from "./slug";

/** PDF bytes → document. Paragraphs are rebuilt from line breaks and blank lines. */
export async function documentFromPdf(bytes: Uint8Array, filename: string): Promise<GlossDocument> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const joined = pages
    .map((p) => rebuildParagraphs(p))
    .filter(Boolean)
    .join("\n\n");
  const blocks = blocksFromText(joined);
  if (!blocks.length) throw new Error("No text could be read from that PDF (it may be scanned images).");
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
