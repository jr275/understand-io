import { describe, expect, it } from "vitest";
import { makeAnchor, resolveAnchor, segmentBlock } from "@/lib/anchors";
import type { Block } from "@/lib/content/types";

const blocks: Block[] = [
  { id: "p1", type: "p", n: 1, text: "The chalk is soft. The chalk is white." },
  { id: "p2", type: "p", n: 2, text: "Over the whole county the chalk is soft and deep." },
  { id: "p3", type: "p", n: 3, text: "A closing line." },
];

describe("anchors", () => {
  it("builds an anchor with quote and context", () => {
    const a = makeAnchor(blocks, { b: "p1", o: 4 }, { b: "p1", o: 17 });
    expect(a.quote).toBe("chalk is soft");
    expect(a.prefix).toBe("The ");
    expect(a.suffix).toBe(". The chalk is white.");
  });

  it("normalises reversed points and spans blocks", () => {
    const a = makeAnchor(blocks, { b: "p2", o: 4 }, { b: "p1", o: 35 });
    expect(a.start).toEqual({ b: "p1", o: 35 });
    expect(a.quote).toBe("te.\nOver");
  });

  it("keeps an anchor whose text still matches", () => {
    const a = makeAnchor(blocks, { b: "p1", o: 4 }, { b: "p1", o: 17 });
    expect(resolveAnchor(blocks, a)).toBe(a);
  });

  it("re-anchors after text shifts, using context to pick among repeats", () => {
    const a = makeAnchor(blocks, { b: "p2", o: 26 }, { b: "p2", o: 39 }); // "chalk is soft" in p2
    const revised: Block[] = [blocks[0], { ...blocks[1], text: "NEW WORDS. Over the whole county the chalk is soft and deep." }, blocks[2]];
    const r = resolveAnchor(revised, a)!;
    expect(r.start.b).toBe("p2");
    expect(revised[1].text.slice(r.start.o, r.end.o)).toBe("chalk is soft");
    // p1 also contains "chalk is soft" but the suffix " and deep" only matches p2.
    expect(r.start.o).toBe(37);
  });

  it("returns null when the quoted text is gone", () => {
    const a = makeAnchor(blocks, { b: "p3", o: 0, }, { b: "p3", o: 9 });
    expect(resolveAnchor([blocks[0], blocks[1], { ...blocks[2], text: "Different." }], a)).toBeNull();
  });

  it("segments a block by overlapping marks", () => {
    const hl = makeAnchor(blocks, { b: "p1", o: 0 }, { b: "p1", o: 17 });
    const gl = makeAnchor(blocks, { b: "p1", o: 4 }, { b: "p1", o: 38 });
    const segs = segmentBlock(blocks[0], blocks, [
      { id: "h", kind: "hl", anchor: hl },
      { id: "g", kind: "gloss", anchor: gl },
    ]);
    expect(segs.map((s) => [s.start, s.end, s.marks.map((m) => m.id).sort().join("+")])).toEqual([
      [0, 4, "h"],
      [4, 17, "g+h"],
      [17, 38, "g"],
    ]);
  });

  it("projects a multi-block anchor onto each block", () => {
    const a = makeAnchor(blocks, { b: "p1", o: 30 }, { b: "p2", o: 4 });
    const s1 = segmentBlock(blocks[0], blocks, [{ id: "x", kind: "hl", anchor: a }]);
    const s2 = segmentBlock(blocks[1], blocks, [{ id: "x", kind: "hl", anchor: a }]);
    expect(s1.at(-1)).toMatchObject({ start: 30, end: 38 });
    expect(s2[0]).toMatchObject({ start: 0, end: 4 });
    expect(segmentBlock(blocks[2], blocks, [{ id: "x", kind: "hl", anchor: a }])[0].marks).toHaveLength(0);
  });
});
