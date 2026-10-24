import { ReadError } from "../errors";
import { readingMinutes, slugFor } from "../slug";
import { finishBlocks } from "../text";
import type { Block, GlossDocument } from "../types";

/** Most characters of text one imported file may hold (the PDF reader's own ceiling, so every format answers to the same one). */
export const IMPORT_MAX_CHARS = 3_000_000;

/** Block ids and paragraph numbers are assigned again over the whole text, so blocks gathered from several parts get one clean sequence. */
export function renumber(blocks: Block[]): Block[] {
  return finishBlocks(blocks.map(({ type, runs, src, alt }) => ({ type, runs, ...(src ? { src } : {}), ...(alt ? { alt } : {}) })));
}

/** Only absolute web images survive: a picture inside a Word file or an EPUB has no address the Reader could load. */
export function withoutLocalFigures(blocks: Block[]): Block[] {
  return blocks.filter((b) => b.type !== "figure" || (b.src && /^https?:\/\//i.test(b.src)));
}

/** The title a file name suggests: no extension, separators read as spaces. */
export function titleFromFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]{1,8}$/, "").replace(/[_]+/g, " ").trim();
  return base || "Untitled";
}

export interface ImportedParts {
  title: string;
  author?: string | null;
  dek?: string | null;
  year?: number | null;
  blocks: Block[];
  /** Shown as the source: the file name. */
  sourceLabel: string;
}

/** The document every importer ends in: same shape as pasted text, so the Reader, the Library and the AI see no difference. */
export function documentFromParts(p: ImportedParts): GlossDocument {
  const blocks = renumber(p.blocks);
  if (!blocks.length) throw new ReadError("Nothing readable in that file.");
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  if (chars > IMPORT_MAX_CHARS) throw new ReadError("That file holds more text than can be read here (over 3 million characters).");
  const title = p.title.trim().slice(0, 200) || "Untitled";
  return {
    slug: slugFor(title),
    kind: "text",
    title,
    author: p.author?.trim() || null,
    dek: p.dek?.trim() || null,
    year: p.year && p.year > 0 && p.year < 3000 ? p.year : null,
    sourceUrl: null,
    sourceLabel: p.sourceLabel,
    topic: "unsorted",
    minutes: readingMinutes(blocks),
    paragraphs: blocks.filter((b) => b.n).length,
    blocks,
  };
}
