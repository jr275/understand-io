import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/content/types";
import { MAX_UTTERANCE, chunkSpeech, speechSegments, spokenText } from "@/lib/speech/segments";

const sample = (name: string) => (JSON.parse(readFileSync(`src/content/samples/${name}.json`, "utf8")) as { blocks: Block[] }).blocks;

describe("spokenText", () => {
  it("drops footnote markers and collapses whitespace", () => {
    expect(spokenText("It ended.[1]  Then   more [12] here.")).toBe("It ended. Then more here.");
    expect(spokenText("[3]")).toBe("");
  });
});

describe("chunkSpeech", () => {
  const long = "The thin soil which covers it all washed away, a curved band of white chalk, here broader, and there narrower, might be followed diagonally across England from Lulworth in Dorset, to Flamborough Head in Yorkshire, a distance of over 280 miles as the crow flies.";
  it("keeps a short sentence whole", () => expect(chunkSpeech("Short one.")).toEqual(["Short one."]));
  it("cuts a long sentence after a clause break, within the limit, and loses nothing", () => {
    const parts = chunkSpeech(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_UTTERANCE);
    expect(parts[0]).toMatch(/[,;:—–]$/);
    expect(parts.join(" ")).toBe(long);
  });
  it("falls back to a space and never splits inside a word", () => {
    const text = "word ".repeat(120).trim();
    for (const p of chunkSpeech(text)) {
      expect(p.length).toBeLessThanOrEqual(MAX_UTTERANCE);
      expect(p).toMatch(/^(word )*word$/);
    }
  });
  it("keeps a single enormous word whole instead of cutting it", () => {
    const giant = "x".repeat(500);
    expect(chunkSpeech(`start ${giant} end`).join(" ")).toBe(`start ${giant} end`);
  });
});

describe("speechSegments on the shipped samples", () => {
  for (const name of ["on-a-piece-of-chalk", "on-thinking-for-oneself", "walden-reading"]) {
    it(`${name}: every chunk is short enough, chunks rebuild the spoken text, markers are never spoken`, () => {
      const segs = speechSegments(sample(name));
      expect(segs.length).toBeGreaterThan(100);
      for (const s of segs) {
        expect(s.spoken).not.toMatch(/\[\d+\]/);
        // A cut right after an unspaced dash ("soil—which") adds one space when joined; no character is ever lost.
        expect(s.chunks.join(" ").replace(/\s+/g, "")).toBe(s.spoken.replace(/\s+/g, ""));
        // a chunk may exceed the limit only when it is one unbreakable word
        for (const c of s.chunks) if (c.length > MAX_UTTERANCE) expect(c).not.toContain(" ");
      }
    });
  }
  it("segments keep offsets into the original block text", () => {
    const blocks = sample("on-a-piece-of-chalk");
    for (const s of speechSegments(blocks)) {
      const b = blocks.find((x) => x.id === s.blockId)!;
      expect(b.text.slice(s.start, s.end).trim()).toBe(s.text);
    }
  });
  it("does not read code blocks aloud", () => {
    const blocks: Block[] = [
      { id: "p1", type: "p", n: 1, text: "Intro sentence." },
      { id: "c1", type: "pre", text: "console.log(x)" },
      { id: "p2", type: "p", n: 2, text: "After the code." },
    ];
    expect(speechSegments(blocks).map((s) => s.text)).toEqual(["Intro sentence.", "After the code."]);
  });
});
