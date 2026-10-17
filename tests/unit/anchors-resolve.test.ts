import { describe, expect, it } from "vitest";
import { blockIndex, clampNote, makeAnchor, resolveAll, resolveAnchor, segmentBlock, snapToGrapheme } from "@/lib/anchors";
import type { Anchor, Block } from "@/lib/content/types";

/** Table-driven cases from the annotation audit (experiments E1-E12): anchors must follow their text, and never attach to the wrong place. */
const B = (...texts: string[]): Block[] => texts.map((text, i) => ({ id: `p${i + 1}`, type: "p", n: i + 1, text }));
const at = (blocks: Block[], b: string, from: number, to: number) => makeAnchor(blocks, { b, o: from }, { b, o: to });
const span = (blocks: Block[], from: [string, number], to: [string, number]) => makeAnchor(blocks, { b: from[0], o: from[1] }, { b: to[0], o: to[1] });
/** What an anchor stored before the neighbour-context fields existed looks like. */
const legacy = (a: Anchor): Anchor => {
  const { prevBlock, nextBlock, ...rest } = a;
  void prevBlock;
  void nextBlock;
  return rest;
};
/** The text an anchor covers in `blocks` (so assertions are about content, not only offsets). */
const textOf = (blocks: Block[], a: Anchor) => makeAnchor(blocks, a.start, a.end).quote;

describe("ANNOT-2: the stored-offset fast path checks the context", () => {
  it("E2: the quote still matches at the stored offsets but the repeat that was annotated moved: follow the context", () => {
    const orig = B("ab foo. foo.");
    const a = at(orig, "p1", 8, 11); // the second "foo"
    const revised = B("12345ab foo. foo.");
    const r = resolveAnchor(revised, a)!;
    expect(r).not.toBe(a);
    expect([r.start.b, r.start.o, r.end.o]).toEqual(["p1", 13, 16]);
  });

  it("an anchor whose quote and context are untouched is returned as the same object", () => {
    const blocks = B("The chalk is soft. The chalk is white.", "Another paragraph.");
    const a = at(blocks, "p1", 4, 17);
    expect(resolveAnchor(blocks, a)).toBe(a);
    expect(resolveAnchor(blocks, legacy(a))).toEqual(legacy(a));
  });

  it("a small edit next to the quote keeps the anchor in place (the position is the evidence)", () => {
    const orig = B("It was a long summer. The chalk is soft and deep.");
    const a = at(orig, "p1", 26, 39);
    const revised = B("It was a long summer. The chalk is soft and deep!");
    const r = resolveAnchor(revised, a)!;
    expect([r.start.o, r.end.o]).toEqual([26, 39]);
  });
});

describe("ANNOT-3: the fallback needs confidence and a clear winner", () => {
  it("E1 (control): a repeated quote in one block follows its prefix and suffix after an insertion", () => {
    const orig = B("The chalk is soft. The chalk is white. Over there the chalk is soft and deep.");
    const o = orig[0].text.lastIndexOf("chalk is soft"); // the third sentence, after two near-identical ones
    const a = at(orig, "p1", o, o + 13);
    const revised = B(`Twelve chars ${orig[0].text}`);
    const r = resolveAnchor(revised, a)!;
    expect([r.start.o, r.end.o]).toEqual([o + 13, o + 26]);
  });

  it("E3: a short quote whose paragraph was rewritten is not moved into an unrelated paragraph", () => {
    const orig = B("Intro.", "Here chalk is described at length.", "Closing.");
    const a = at(orig, "p2", 5, 10);
    const revised = B("Intro.", "A completely different sentence.", "Another chalk mention, unrelated.", "Closing.");
    expect(resolveAnchor(revised, a)).toBeNull();
  });

  it("E3: a quote is not matched inside a longer unrelated word", () => {
    const orig = B("Intro.", "Here chalk is described.");
    const a = at(orig, "p2", 5, 10);
    expect(resolveAnchor(B("Intro.", "Something else.", "unchalked is a word"), a)).toBeNull();
  });

  it('E3: "It is" does not wander to another paragraph when its own was rewritten', () => {
    const orig = B("It is soft.", "Other.");
    const a = at(orig, "p1", 0, 5);
    expect(resolveAnchor(B("Rewritten completely.", "Other. And where It is the same place."), a)).toBeNull();
  });

  it("E3: a distinctive 40-character quote that moved to another paragraph is still found", () => {
    const quote = "the shells of tiny sea creatures long ag";
    expect(quote).toHaveLength(40);
    const orig = B("Chalk is made of " + quote + "o.", "Second paragraph.");
    const a = at(orig, "p1", 17, 57);
    const revised = B("Second paragraph.", "A new intro.", `Rewritten: chalk is made of ${quote}o, they say.`);
    const r = resolveAnchor(revised, a)!;
    expect(r.start.b).toBe("p3");
    expect(textOf(revised, r)).toBe(quote);
  });

  it("E4: renumbered block ids with unique text: the quote is found in its new block", () => {
    const orig = B("Alpha", "Beta", "Gamma");
    const a = at(orig, "p2", 0, 4);
    const revised = B("New", "Alpha", "Beta", "Gamma"); // every id now names a different paragraph (E12)
    const r = resolveAnchor(revised, a)!;
    expect([r.start.b, r.start.o, r.end.o]).toEqual(["p3", 0, 4]);
  });

  it("E4b: identical short paragraphs are told apart by the neighbouring blocks", () => {
    const orig = B("Yes.", "No.", "Yes.");
    const a = at(orig, "p3", 0, 4); // the second "Yes."
    const revised = B("Preface.", "Yes.", "No.", "Yes.");
    const r = resolveAnchor(revised, a)!;
    expect([r.start.b, r.start.o]).toEqual(["p4", 0]);
  });

  it("E4b: with no neighbour context (an anchor stored by an older version) the ambiguity makes it an orphan, never the first hit", () => {
    const orig = B("Yes.", "No.", "Yes.");
    const a = legacy(at(orig, "p3", 0, 4));
    const r = resolveAnchor(B("Preface.", "Yes.", "No.", "Yes."), a);
    expect(r?.start.b).not.toBe("p2");
  });

  it("two equally good places are ambiguous, so the anchor is orphaned", () => {
    const orig = B("a", "b", "c", "d", "Same words here, twice over.");
    const a = legacy(at(orig, "p5", 0, 28)); // no neighbour context to choose with
    const revised = B("Same words here, twice over.", "x", "Same words here, twice over.");
    expect(resolveAnchor(revised, a)).toBeNull();
  });
});

describe("ANNOT-6: multi-block and newline quotes", () => {
  const base = B("First paragraph ends here.", "Second paragraph middle", "Third para opens the end of it all.", "Fourth.");
  const multi = span(base, ["p1", 16], ["p3", 10]); // "ends here.\nSecond paragraph middle\nThird para"

  it("a first block with new text in front still resolves (E5)", () => {
    const revised = [{ ...base[0], text: "XX " + base[0].text }, ...base.slice(1)];
    const r = resolveAnchor(revised, multi)!;
    expect([r.start.b, r.start.o, r.end.b, r.end.o]).toEqual(["p1", 19, "p3", 10]);
  });

  it("E5: blocks inserted before the anchor shift it, text unchanged", () => {
    const revised = [{ id: "pn", type: "p" as const, text: "Inserted." }, ...base];
    const r = resolveAnchor(revised, multi)!;
    expect([r.start.b, r.end.b]).toEqual(["p1", "p3"]);
    expect(textOf(revised, r)).toBe(multi.quote);
  });

  it("E5b: the first line repeats inside its block (endsWith, not the first indexOf)", () => {
    const orig = B("ab ab", "tail text");
    const a = span(orig, ["p1", 3], ["p2", 4]);
    expect(a.quote).toBe("ab\ntail");
    const r = resolveAnchor(B("xx ab ab", "tail text"), a)!;
    expect([r.start.b, r.start.o, r.end.b, r.end.o]).toEqual(["p1", 6, "p2", 4]);
  });

  it("E5c: a selection that starts at the very end of a block (empty first line) survives an edit of that block", () => {
    const orig = B("First para.", "Second para middle", "Third.");
    const a = span(orig, ["p1", 11], ["p2", 6]);
    expect(a.quote).toBe("\nSecond");
    const revised = B("First para, edited.", "Second para middle", "Third.");
    const r = resolveAnchor(revised, a)!;
    expect([r.start.b, r.start.o, r.end.b, r.end.o]).toEqual(["p1", 19, "p2", 6]);
  });

  it("a middle block that was edited is tolerated", () => {
    const revised = [base[0], { ...base[1], text: "Second paragraph, now reworded" }, ...base.slice(2)];
    const r = resolveAnchor(revised, multi)!;
    expect([r.start.b, r.start.o, r.end.b, r.end.o]).toEqual(["p1", 16, "p3", 10]);
  });

  it("E5f: a middle block that was removed is tolerated", () => {
    const orig = B("First paragraph ends here.", "Middle one", "Middle two", "Third para opens the end of it all.");
    const a = span(orig, ["p1", 16], ["p4", 10]);
    const revised = B("First paragraph ends here.", "Middle one", "Third para opens the end of it all.");
    const r = resolveAnchor(revised, a)!;
    expect([r.start.b, r.start.o, r.end.b, r.end.o]).toEqual(["p1", 16, "p3", 10]);
  });

  it("E5e: when the last block is rewritten inside the quote the passage is gone: orphaned (no exact text to follow)", () => {
    const revised = [...base.slice(0, 2), { ...base[2], text: "Rewritten entirely." }, base[3]];
    expect(resolveAnchor(revised, multi)).toBeNull();
  });

  it("E7: a quote with a newline inside one `pre` block is searched as one block, not split into lines", () => {
    const orig: Block[] = [{ id: "p1", type: "pre", text: "line one\nline two\nline three" }];
    const a = at(orig, "p1", 5, 17);
    expect(a.quote).toBe("one\nline two");
    const revised: Block[] = [{ id: "p1", type: "pre", text: "a new header line\nline one\nline two\nline three" }];
    const r = resolveAnchor(revised, a)!;
    expect([r.start.b, r.start.o, r.end.o]).toEqual(["p1", 23, 35]);
    // and after a block was added in front (every id shifts)
    const shifted: Block[] = [{ id: "p1", type: "p", text: "Intro." }, { id: "p2", type: "pre", text: "line one\nline two\nline three" }];
    const r2 = resolveAnchor(shifted, a)!;
    expect([r2.start.b, r2.start.o, r2.end.o]).toEqual(["p2", 5, 17]);
  });
});

describe("ANNOT-22: defensive helpers", () => {
  const blocks = B("Hello world");
  it("E9: makeAnchor refuses an unknown block id instead of quietly using block 0", () => {
    expect(() => makeAnchor(blocks, { b: "nope", o: 0 }, { b: "p1", o: 5 })).toThrow(/unknown block id/);
    expect(() => makeAnchor(blocks, { b: "p1", o: 0 }, { b: "gone", o: 5 })).toThrow(/unknown block id/);
  });

  it("E9: segmentBlock clamps offsets to the block", () => {
    const mk = (s: number, e: number): { id: string; kind: string; anchor: Anchor }[] => [{ id: "m", kind: "hl", anchor: { start: { b: "p1", o: s }, end: { b: "p1", o: e }, quote: "" } }];
    expect(segmentBlock(blocks[0], blocks, mk(6, 99)).map((s) => [s.start, s.end, s.marks.length])).toEqual([[0, 6, 0], [6, 11, 1]]);
    expect(segmentBlock(blocks[0], blocks, mk(50, 60)).every((s) => s.marks.length === 0)).toBe(true);
    expect(segmentBlock(blocks[0], blocks, mk(-5, 3)).map((s) => [s.start, s.end, s.marks.length])).toEqual([[0, 3, 1], [3, 11, 0]]);
  });

  it("an anchor to a block that no longer exists is not resolved to block 0", () => {
    const a: Anchor = { start: { b: "zzz", o: 0 }, end: { b: "zzz", o: 5 }, quote: "Hello world and a long distinct tail", prefix: "", suffix: "" };
    expect(resolveAnchor(blocks, a)).toBeNull();
  });
});

describe("clampNote (ANNOT-10)", () => {
  it("cuts at the limit and never leaves half of a surrogate pair", () => {
    expect(clampNote("a".repeat(5001))).toHaveLength(5000);
    expect(clampNote("short")).toBe("short");
    const cut = clampNote("a".repeat(4999) + "👍🏽"); // the pair would be split after 5000 units
    expect(cut).toBe("a".repeat(4999));
    expect(clampNote("👍", 1)).toBe("");
  });
});

describe("ANNOT-15: Unicode", () => {
  it("E8: an anchor made on NFD text resolves against the same text re-imported as NFC", () => {
    const nfd = B("We went to the Cafe\u0301 yesterday and loved it.");
    const a = at(nfd, "p1", 15, 20); // "Cafe" + combining acute
    expect(a.quote).toBe("Cafe\u0301");
    const nfc = B("We went to the Caf\u00e9 yesterday and loved it.");
    const r = resolveAnchor(nfc, a)!;
    expect(r).not.toBeNull();
    expect(textOf(nfc, r)).toBe("Caf\u00e9");
  });

  it("E8: an anchor with typographic quotes resolves against the same text with straight quotes", () => {
    const orig = B("He said \u201chello there\u201d loudly, and left.");
    const a = at(orig, "p1", 8, 21);
    expect(a.quote).toBe("\u201chello there\u201d");
    const straight = B('He said "hello there" loudly, and left.');
    const r = resolveAnchor(straight, a)!;
    expect(textOf(straight, r)).toBe('"hello there"');
  });

  it("folding does not conjure matches: different words stay orphaned", () => {
    const orig = B("He said \u201chello there\u201d loudly, and left.");
    const a = at(orig, "p1", 8, 21);
    expect(resolveAnchor(B('He said "goodbye now" loudly, and left.'), a)).toBeNull();
  });

  it("snapToGrapheme moves offsets out of the middle of an emoji with a skin tone and of a combining sequence", () => {
    const t = "a\u{1F44D}\u{1F3FD}b"; // a, thumbs-up (2 units), skin tone (2 units), b
    expect(t).toHaveLength(6);
    expect([1, 2, 3, 4].map((o) => snapToGrapheme(t, o, "start"))).toEqual([1, 1, 1, 1]);
    expect([1, 2, 3, 4, 5].map((o) => snapToGrapheme(t, o, "end"))).toEqual([1, 5, 5, 5, 5]);
    expect([snapToGrapheme(t, 0, "start"), snapToGrapheme(t, 6, "end")]).toEqual([0, 6]);
    expect([snapToGrapheme("e\u0301x", 1, "start"), snapToGrapheme("e\u0301x", 1, "end")]).toEqual([0, 2]);
    expect(snapToGrapheme("plain text", 5, "start")).toBe(5);
  });
});

describe("ANNOT-18: cost of marking a long text", () => {
  const big = B(...Array.from({ length: 3000 }, (_, i) => `Paragraph number ${i} with some words in it.`));
  const marks = Array.from({ length: 40 }, (_, k) => ({ id: `m${k}`, kind: "hl", anchor: at(big, `p${k * 70 + 1}`, 0, 9) }));

  it("segmenting all 3000 blocks for 40 marks with one shared block index stays far below the 154 ms the per-call index cost", () => {
    const idx = blockIndex(big);
    const t0 = performance.now();
    let segs = 0;
    for (const b of big) segs += segmentBlock(b, big, marks, idx).filter((s) => s.marks.length).length;
    const ms = performance.now() - t0;
    expect(segs).toBe(40);
    expect(ms).toBeLessThan(60);
  });

  it("resolveAll resolves each anchor once per block list: asking again is a cache hit that returns the very same results", () => {
    const items = marks.map((m) => ({ anchor: m.anchor }));
    const first = resolveAll(big, items);
    const t0 = performance.now();
    const second = resolveAll(big, items);
    expect(performance.now() - t0).toBeLessThan(20);
    expect(second.map((r) => r.anchor)).toEqual(first.map((r) => r.anchor));
    expect(first.every((r) => r.status === "ok")).toBe(true);
  });
});
