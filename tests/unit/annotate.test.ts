import { describe, expect, it } from "vitest";
import { makeAnchor, resolveAll } from "@/lib/anchors";
import { decideAnnotate, marksOnRange } from "@/lib/anchors/annotate";
import type { Annotation, Block, HighlightColor } from "@/lib/content/types";

/** ANNOT-14: an identical range and kind updates or toggles the existing mark instead of stacking another one. */
const blocks: Block[] = [
  { id: "p1", type: "p", n: 1, text: "The chalk is soft. The chalk is white." },
  { id: "p2", type: "p", n: 2, text: "Over the whole county the chalk is soft and deep." },
];
const range = (b: string, from: number, to: number) => makeAnchor(blocks, { b, o: from }, { b, o: to });
const ann = (id: string, kind: Annotation["kind"], color: HighlightColor, from = 4, to = 17, b = "p1"): Annotation => ({ id, documentId: "d", kind, color, anchor: range(b, from, to), createdAt: 1, updatedAt: 1 });
const decide = (list: Annotation[], kind: Annotation["kind"], color: HighlightColor, from = 4, to = 17) => decideAnnotate(resolveAll(blocks, list), range("p1", from, to), kind, color);

describe("decideAnnotate", () => {
  it("adds when nothing covers the range", () => {
    expect(decide([], "highlight", "yellow")).toEqual({ type: "add" });
    expect(decide([ann("a", "highlight", "yellow", 0, 3)], "highlight", "yellow")).toEqual({ type: "add" }); // a different range
    expect(decide([ann("a", "highlight", "yellow", 4, 18)], "highlight", "yellow")).toEqual({ type: "add" }); // overlapping, not identical
  });

  it("the same kind and colour on the same range toggles the mark off", () => {
    expect(decide([ann("a", "highlight", "yellow")], "highlight", "yellow")).toEqual({ type: "remove", ids: ["a"] });
    expect(decide([ann("u", "underline", "blue")], "underline", "blue")).toEqual({ type: "remove", ids: ["u"] });
  });

  it("the same kind in another colour recolours instead of stacking", () => {
    expect(decide([ann("a", "highlight", "yellow")], "highlight", "green")).toEqual({ type: "recolor", ids: ["a"] });
  });

  it("a highlight and an underline on the same range are different kinds and may coexist", () => {
    expect(decide([ann("a", "highlight", "yellow")], "underline", "yellow")).toEqual({ type: "add" });
  });

  it("notes always add: each note carries its own text", () => {
    expect(decide([ann("n", "note", "yellow")], "note", "yellow")).toEqual({ type: "add" });
  });

  it("marks stacked before this rule existed are treated as one", () => {
    const stacked = [ann("a", "highlight", "yellow"), ann("b", "highlight", "yellow"), ann("c", "highlight", "pink")];
    expect(decide(stacked, "highlight", "yellow")).toEqual({ type: "recolor", ids: ["c"] });
    expect(decide(stacked.slice(0, 2), "highlight", "yellow")).toEqual({ type: "remove", ids: ["a", "b"] });
  });

  it("compares against where the text is now, and ignores orphans", () => {
    const moved: Block[] = [{ id: "p1", type: "p", text: "Twelve chars The chalk is soft. The chalk is white." }, blocks[1]];
    const stale = ann("a", "highlight", "yellow"); // stored at 4..17, the text is now 13 characters further on
    const resolved = resolveAll(moved, [stale]);
    expect(resolved[0].status).toBe("moved");
    const now = makeAnchor(moved, { b: "p1", o: 17 }, { b: "p1", o: 30 });
    expect(decideAnnotate(resolved, now, "highlight", "yellow")).toEqual({ type: "remove", ids: ["a"] });
    expect(marksOnRange(resolveAll(blocks, [{ ...stale, anchor: { ...stale.anchor, quote: "gone for good, a distinctive passage" } }]), range("p1", 4, 17))).toEqual([]);
  });
});
