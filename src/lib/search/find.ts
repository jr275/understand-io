import type { Block } from "@/lib/content/types";

/**
 * Literal search inside the open document: the words as typed, not a question to a model. Case, accents, quote style, dash style and
 * non-breaking spaces are ignored, and the offsets returned are positions in the original block text.
 */

export interface FindMatch {
  blockId: string;
  start: number;
  end: number;
}

const MAX_MATCHES = 2000;
export const MIN_FIND = 2;

function foldChar(ch: string): string {
  const base = ch.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
  if (/^[‘’‚‛′`´]$/.test(ch)) return "'";
  if (/^[“”„‟″]$/.test(ch)) return '"';
  if (/^[‐-―−]$/.test(ch)) return "-";
  if (ch === " " || ch === " ") return " ";
  return base || ch;
}

/** The folded text plus, for each folded character, the index in the original it came from. */
function fold(text: string): { folded: string; from: number[] } {
  let folded = "";
  const from: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const f = foldChar(ch);
    // A run of whitespace is one space, as in a browser's own find: the query "second line" finds "second   line".
    if (/^\s$/.test(f) && folded.endsWith(" ")) {
      i += ch.length;
      continue;
    }
    const out = /^\s$/.test(f) ? " " : f;
    folded += out;
    for (let j = 0; j < out.length; j++) from.push(i); // one entry per UTF-16 unit of the folded text
    i += ch.length;
  }
  return { folded, from };
}

export function findAll(blocks: Block[], query: string): { matches: FindMatch[]; truncated: boolean } {
  const q = fold(query.trim().replace(/\s+/g, " ")).folded;
  if ([...q].length < MIN_FIND) return { matches: [], truncated: false };
  const matches: FindMatch[] = [];
  for (const b of blocks) {
    if (b.type === "figure" || !b.text) continue;
    const { folded, from } = fold(b.text);
    let at = folded.indexOf(q);
    while (at >= 0) {
      const lastFolded = at + q.length - 1;
      const start = from[at];
      // End: the original index just after the character the last folded character came from.
      const lastOrig = from[lastFolded];
      const cp = b.text.codePointAt(lastOrig)!;
      matches.push({ blockId: b.id, start, end: lastOrig + String.fromCodePoint(cp).length });
      if (matches.length >= MAX_MATCHES) return { matches, truncated: true };
      at = folded.indexOf(q, at + Math.max(1, q.length));
    }
  }
  return { matches, truncated: false };
}

export interface Section {
  blockId: string;
  title: string;
  level: 2 | 3;
  /** Number of the first numbered paragraph after the heading, when there is one. */
  n?: number;
}

export function sections(blocks: Block[]): Section[] {
  const out: Section[] = [];
  blocks.forEach((b, i) => {
    if ((b.type !== "h2" && b.type !== "h3") || !b.text.trim()) return;
    const next = blocks.slice(i + 1).find((x) => x.n);
    out.push({ blockId: b.id, title: b.text.trim(), level: b.type === "h2" ? 2 : 3, n: next?.n });
  });
  return out;
}
