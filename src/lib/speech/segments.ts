import type { Block } from "@/lib/content/types";
import { sentences } from "@/lib/search/tokenize";

export interface SpeechSegment {
  blockId: string;
  start: number;
  end: number;
  /** The text as displayed (offsets index into the block's text). */
  text: string;
  /** What the voice says: the text without footnote markers like "[1]". */
  spoken: string;
  /** `spoken` cut into pieces a voice can read reliably; one piece for most sentences. */
  chunks: string[];
}

/**
 * Block types that are read aloud. Code blocks (`pre`) and figures are skipped on purpose: a voice reads code as
 * punctuation noise, and a figure's text is a caption the reader can see.
 */
const SPOKEN_TYPES = new Set(["p", "h2", "h3", "quote", "li", "note"]);

/** Voices (notably Chrome's network voices) cut or stall utterances much beyond this many characters. */
export const MAX_UTTERANCE = 220;
const MIN_CHUNK = 50;

/** The text a voice should say: footnote markers removed, whitespace collapsed. */
export function spokenText(text: string) {
  return text.replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Cut a long sentence into pieces of at most `max` characters, preferably after a clause break (; : , or a dash),
 * otherwise at a space, never inside a word. The pieces joined with a space reproduce the input.
 */
export function chunkSpeech(spoken: string, max = MAX_UTTERANCE): string[] {
  const out: string[] = [];
  let rest = spoken.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = -1;
    const clause = /[;:,]\s|[—–]/g;
    for (let m = clause.exec(window); m; m = clause.exec(window)) if (m.index + 1 >= MIN_CHUNK) cut = m.index + 1;
    if (cut < 0) {
      const space = window.lastIndexOf(" ");
      if (space >= MIN_CHUNK) cut = space;
      else {
        const next = rest.indexOf(" ", max); // one very long word: keep it whole
        cut = next < 0 ? rest.length : next;
      }
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Sentence-level speech segments for a range of blocks (optionally clipped to offsets). */
export function speechSegments(
  blocks: Block[],
  from?: { b: string; o: number },
  to?: { b: string; o: number },
): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  let active = !from;
  for (const b of blocks) {
    if (from && b.id === from.b) active = true;
    if (!active) continue;
    if (SPOKEN_TYPES.has(b.type)) {
      const lo = from && b.id === from.b ? from.o : 0;
      const hi = to && b.id === to.b ? to.o : b.text.length;
      for (const s of sentences(b.text)) {
        if (s.end <= lo || s.start >= hi) continue;
        const start = Math.max(s.start, lo);
        const end = Math.min(s.end, hi);
        const text = b.text.slice(start, end).trim();
        const spoken = spokenText(text);
        if (spoken) out.push({ blockId: b.id, start, end, text, spoken, chunks: chunkSpeech(spoken) });
      }
    }
    if (to && b.id === to.b) break;
  }
  return out;
}
