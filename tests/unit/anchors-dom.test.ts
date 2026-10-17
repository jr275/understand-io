// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { anchorBlockIds, anchorFromSelection, pointFromNode, rangeForAnchor } from "@/lib/anchors";
import type { Block } from "@/lib/content/types";

/**
 * ANNOT-7 / ANNOT-8 with a real DOM (jsdom: real Range, Selection and TreeWalker; no mocks). The markup mirrors Block.tsx:
 * a `.blk` with a gutter button outside `.blk-text`, and inline <em>/<strong> inside the text.
 */
const blocks: Block[] = [
  { id: "p1", type: "p", n: 1, text: "One emphasised tail of one." },
  { id: "p2", type: "p", n: 2, text: "Second paragraph, bold part." },
  { id: "p3", type: "p", n: 3, text: "Third and last." },
];

beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <div class="prose-read">
        <div class="blk" data-block="p1"><button class="pnum">1</button><span class="blk-text">One <em id="em">emphasised</em> tail of one.</span></div>
        <div class="blk" data-block="p2"><button class="pnum">2</button><span class="blk-text">Second paragraph, <strong>bold part</strong>.</span></div>
        <div class="blk" data-block="p3"><button class="pnum">3</button><span class="blk-text">Third and last.</span></div>
      </div>
      <footer id="footer"><p id="foot">Footer text outside every block.</p></footer>
    </main>`;
  (globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };
});

const $ = (sel: string) => document.querySelector(sel)!;
const blk = (id: string) => $(`.blk[data-block="${id}"]`);
const textNode = (id: string, i = 0) => {
  const w = document.createTreeWalker(blk(id).querySelector(".blk-text")!, NodeFilter.SHOW_TEXT);
  let n = w.nextNode();
  for (let k = 0; k < i; k++) n = w.nextNode();
  return n!;
};
function select(sc: Node, so: number, ec: Node, eo: number) {
  const r = document.createRange();
  r.setStart(sc, so);
  r.setEnd(ec, eo);
  const s = document.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
  return s;
}

describe("pointFromNode", () => {
  it("counts text inside a text node, across inline elements", () => {
    expect(pointFromNode(textNode("p1", 0), 2)).toEqual({ b: "p1", o: 2 });
    expect(pointFromNode(textNode("p1", 1), 3)).toEqual({ b: "p1", o: 7 }); // "One " + "emp"
    expect(pointFromNode(textNode("p1", 2), 5)).toEqual({ b: "p1", o: 19 }); // " tail" after the em
  });

  it("ANNOT-8: an element-boundary end maps to the text before it, not to the end of the block", () => {
    const em = $("#em");
    expect(pointFromNode(em, 0)).toEqual({ b: "p1", o: 4 });
    expect(pointFromNode(em, 1)).toEqual({ b: "p1", o: 14 }); // after "emphasised": the old code answered 27
    expect(pointFromNode(blk("p1").querySelector(".blk-text")!, 3)).toEqual({ b: "p1", o: 27 }); // after all three children
    expect(pointFromNode(blk("p1").querySelector(".blk-text")!, 1)).toEqual({ b: "p1", o: 4 });
  });

  it("maps the gutter and the block edges, and answers null outside every block", () => {
    expect(pointFromNode(blk("p2").querySelector(".pnum")!.firstChild!, 0)).toEqual({ b: "p2", o: 0 });
    expect(pointFromNode(blk("p2"), 0)).toEqual({ b: "p2", o: 0 });
    expect(pointFromNode(blk("p2"), blk("p2").childNodes.length)).toEqual({ b: "p2", o: blocks[1].text.length });
    expect(pointFromNode($("#foot").firstChild!, 3)).toBeNull();
    expect(pointFromNode($(".prose-read"), 1)).toBeNull();
  });
});

describe("anchorFromSelection", () => {
  it("a selection inside one block, ending at an element boundary, keeps its exact end", () => {
    const a = anchorFromSelection(select(textNode("p1", 0), 0, $("#em"), 1), blocks)!;
    expect(a.quote).toBe("One emphasised");
    expect([a.start.o, a.end.o]).toEqual([0, 14]);
  });

  it("a selection across blocks quotes both ends", () => {
    const a = anchorFromSelection(select(textNode("p1", 2), 1, textNode("p2", 0), 6), blocks)!;
    expect([a.start.b, a.end.b]).toEqual(["p1", "p2"]);
    expect(a.quote).toBe("tail of one.\nSecond");
  });

  it("ANNOT-7: a triple-click (paragraph start to offset 0 of the next block) covers that paragraph only", () => {
    const a = anchorFromSelection(select(textNode("p1", 0), 0, blk("p2"), 0), blocks)!;
    expect(a.end).toEqual({ b: "p1", o: blocks[0].text.length });
    expect(a.quote).toBe("One emphasised tail of one.");
    expect(a.quote.endsWith("\n")).toBe(false);
    expect(anchorBlockIds(blocks, a)).toEqual(["p1"]); // no extra paragraph of context for gloss prompts
    // the same shape, with the next block's gutter as the end container
    const b = anchorFromSelection(select(textNode("p1", 0), 0, blk("p2").querySelector(".pnum")!.firstChild!, 0), blocks)!;
    expect(b.quote).toBe(a.quote);
  });

  it("ANNOT-7: a triple-click on the last paragraph (end outside every block) still gives an anchor", () => {
    for (const [node, off] of [
      [$(".prose-read"), $(".prose-read").childNodes.length],
      [$("#foot").firstChild!, 0],
      [$("#footer"), 0],
    ] as [Node, number][]) {
      const a = anchorFromSelection(select(textNode("p3"), 0, node, off), blocks)!;
      expect(a, `end at ${(node as Element).id || node.nodeName}`).not.toBeNull();
      expect(a.quote).toBe("Third and last.");
      expect(a.end).toEqual({ b: "p3", o: blocks[2].text.length });
    }
  });

  it("a range that starts in the gutter or before the first block is clamped to the start of the first block it touches", () => {
    const a = anchorFromSelection(select(blk("p2").querySelector(".pnum")!.firstChild!, 0, textNode("p2", 0), 6), blocks)!;
    expect(a.start).toEqual({ b: "p2", o: 0 });
    expect(a.quote).toBe("Second");
    const c = anchorFromSelection(select($("main"), 0, textNode("p1", 0), 3), blocks)!;
    expect(c.start).toEqual({ b: "p1", o: 0 });
    expect(c.quote).toBe("One");
  });

  it("a selection that starts at the very end of a block and runs into the next does not begin with a newline", () => {
    const a = anchorFromSelection(select(textNode("p1", 2), textNode("p1", 2).textContent!.length, textNode("p2", 0), 6), blocks)!;
    expect(a.start).toEqual({ b: "p2", o: 0 });
    expect(a.quote).toBe("Second");
  });

  it("selections wholly outside the blocks, or collapsed, give no anchor", () => {
    expect(anchorFromSelection(select($("#foot").firstChild!, 0, $("#foot").firstChild!, 5), blocks)).toBeNull();
    expect(anchorFromSelection(select(textNode("p1", 0), 3, textNode("p1", 0), 3), blocks)).toBeNull();
  });

  it("a page whose block ids are not in the blocks gives no anchor instead of using block 0", () => {
    expect(anchorFromSelection(select(textNode("p2"), 0, textNode("p2"), 6), blocks.filter((b) => b.id !== "p2"))).toBeNull();
  });
});

describe("rangeForAnchor", () => {
  it("round-trips: the range of an anchor selects exactly its quote (single and multi-block, across inline elements)", () => {
    const one = anchorFromSelection(select(textNode("p1", 0), 2, textNode("p1", 2), 8), blocks)!;
    expect(rangeForAnchor(document.body, one)!.toString()).toBe(one.quote);
    const many = anchorFromSelection(select(textNode("p1", 2), 1, textNode("p3"), 5), blocks)!;
    expect(many.quote).toBe("tail of one.\nSecond paragraph, bold part.\nThird");
    // (a range over several blocks also contains the gutter numbers between them, so compare its end points instead of its text)
    const r = rangeForAnchor(document.body, many)!;
    expect(pointFromNode(r.startContainer, r.startOffset)).toEqual(many.start);
    expect(pointFromNode(r.endContainer, r.endOffset)).toEqual(many.end);
  });
});
