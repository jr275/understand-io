import type { Block } from "@/lib/content/types";
import { sentences } from "@/lib/search/tokenize";

export interface SpeechSegment {
  blockId: string;
  start: number;
  end: number;
  text: string;
}

const SPOKEN_TYPES = new Set(["p", "h2", "h3", "quote", "li", "note", "pre"]);

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
        if (text) out.push({ blockId: b.id, start, end, text });
      }
    }
    if (to && b.id === to.b) break;
  }
  return out;
}
