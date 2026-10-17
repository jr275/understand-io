import { describe, expect, it } from "vitest";
import { blockIndex, makeAnchor, resolveAnchor } from "@/lib/anchors";
import type { Block } from "@/lib/content/types";

/**
 * Randomised check of the anchor contract (seeded, so a failure reproduces): for random paragraphs and random ranges,
 *  1. resolving an anchor against unchanged blocks returns the same anchor, and
 *  2. after text is inserted before the range, the anchor either follows its text (the resolved quote equals the original
 *     quote) or is reported as orphaned. It must never attach to different text.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = "the chalk is a soft white rock made of tiny shells and sea floor mud laid down slowly over many ages while great chapters of history were written in it".split(" ");

function paragraph(r: () => number, words: number) {
  return Array.from({ length: words }, () => WORDS[Math.floor(r() * WORDS.length)]).join(" ") + ".";
}

describe("anchors, randomised", () => {
  for (let seed = 1; seed <= 200; seed++) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const blocks: Block[] = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => ({ id: `p${i + 1}`, type: "p", n: i + 1, text: paragraph(r, 8 + Math.floor(r() * 25)) }));
      const idx = blockIndex(blocks);
      const bi = Math.floor(r() * blocks.length);
      const text = blocks[bi].text;
      const from = Math.floor(r() * (text.length - 4));
      const to = Math.min(text.length, from + 3 + Math.floor(r() * 30));
      const a = makeAnchor(blocks, { b: blocks[bi].id, o: from }, { b: blocks[bi].id, o: to }, idx);

      expect(resolveAnchor(blocks, a, idx)).toBe(a);

      const prefix = paragraph(r, 1 + Math.floor(r() * 6)) + " ";
      const edited = blocks.map((b, i) => (i === bi ? { ...b, text: prefix + b.text } : b));
      const moved = resolveAnchor(edited, a);
      if (moved) {
        const now = makeAnchor(edited, moved.start, moved.end);
        expect(now.quote).toBe(a.quote);
      }
    });
  }

  it("at least most random cases follow their text instead of giving up", () => {
    let followed = 0;
    let total = 0;
    for (let seed = 1000; seed < 1100; seed++) {
      const r = rng(seed);
      const blocks: Block[] = [{ id: "p1", type: "p", n: 1, text: paragraph(r, 20 + Math.floor(r() * 20)) }];
      const from = Math.floor(r() * (blocks[0].text.length - 20));
      const a = makeAnchor(blocks, { b: "p1", o: from }, { b: "p1", o: from + 15 });
      const edited = [{ ...blocks[0], text: "A new opening sentence here. " + blocks[0].text }];
      total++;
      if (resolveAnchor(edited, a)) followed++;
    }
    expect(followed / total).toBeGreaterThanOrEqual(0.8);
  });
});
