import { describe, expect, it } from "vitest";
import { makeAnchor } from "@/lib/anchors";
import { kindLabel, markCounts, reviewMarks, type ReviewDoc } from "@/lib/store/marksReview";
import type { Annotation, Block } from "@/lib/content/types";

const TEXT = "Chalk is a soft white porous sedimentary carbonate rock composed of calcite.";
const block = (id: string, text: string): Block => ({ id, type: "p", text, n: 1, runs: [{ text }] });
const blocks = [block("p1", TEXT)];

const mark = (id: string, documentId: string, kind: Annotation["kind"], quote: string, createdAt: number, over: Partial<Annotation> = {}): Annotation => {
  const start = TEXT.indexOf(quote);
  return {
    id,
    documentId,
    kind,
    color: kind === "highlight" ? "yellow" : undefined,
    // A real anchor, with the context a mark made in the Reader carries (that context is what lets a passage be found again).
    anchor: start >= 0 ? makeAnchor(blocks, { b: "p1", o: start }, { b: "p1", o: start + quote.length }) : { start: { b: "p1", o: 0 }, end: { b: "p1", o: quote.length }, quote },
    createdAt,
    updatedAt: createdAt,
    ...over,
  };
};

const docA: ReviewDoc = { id: "A", slug: "alpha", title: "Alpha", blocks };
const docB: ReviewDoc = { id: "B", slug: "beta", title: "Beta" }; // text not in this browser

describe("reviewMarks", () => {
  const annotations = {
    A: [mark("a1", "A", "highlight", "soft white", 10), mark("a2", "A", "underline", "calcite", 30), mark("a3", "A", "note", "porous", 20, { note: "check this" })],
    B: [mark("b1", "B", "highlight", "anything", 40)],
  };

  it("groups marks by text, newest text first and newest mark first inside each", () => {
    const groups = reviewMarks([docA, docB], annotations);
    expect(groups.map((g) => g.slug)).toEqual(["beta", "alpha"]); // beta's mark (40) is the newest of all
    expect(groups[1].marks.map((m) => m.annotation.id)).toEqual(["a2", "a3", "a1"]);
  });

  it("filters by kind and leaves out texts left with no marks", () => {
    expect(reviewMarks([docA, docB], annotations, "underline").map((g) => g.slug)).toEqual(["alpha"]);
    expect(reviewMarks([docA, docB], annotations, "highlight").map((g) => g.slug)).toEqual(["beta", "alpha"]);
    expect(reviewMarks([docA, docB], annotations, "note")[0].marks.map((m) => m.annotation.id)).toEqual(["a3"]);
  });

  it("says where a passage stands only when it has the text: found, or missing", () => {
    const lost = { A: [...annotations.A, mark("a4", "A", "highlight", "soft white", 50, { anchor: { start: { b: "p1", o: 0 }, end: { b: "p1", o: 22 }, quote: "text that was rewritten away" } })] };
    const rows = reviewMarks([docA], lost)[0].marks;
    expect(rows.find((r) => r.annotation.id === "a1")?.status).toBe("found");
    expect(rows.find((r) => r.annotation.id === "a4")?.status).toBe("missing");
  });

  it("does not claim anything about a text whose words are not in this browser", () => {
    expect(reviewMarks([docB], annotations)[0].marks[0].status).toBe("unchecked");
  });

  it("finds a passage again when the text moved around it, and says so", () => {
    const shifted: ReviewDoc = { ...docA, blocks: [block("p1", `A new first sentence was added here. ${TEXT}`)] };
    const row = reviewMarks([shifted], { A: [mark("a1", "A", "highlight", "soft white", 10)] })[0].marks[0];
    expect(["found", "moved"]).toContain(row.status);
  });

  it("skips marks whose text is not on the shelf, and texts without an id", () => {
    expect(reviewMarks([docA], { ...annotations, GONE: [mark("g1", "GONE", "highlight", "x", 1)] }).map((g) => g.id)).toEqual(["A"]);
    expect(reviewMarks([{ slug: "idless", title: "No id" }], annotations)).toEqual([]);
  });
});

describe("markCounts and kindLabel", () => {
  it("counts every kind regardless of the filter", () => {
    const annotations = { A: [mark("a1", "A", "highlight", "soft white", 1), mark("a2", "A", "underline", "calcite", 2), mark("a3", "A", "underline", "porous", 3)] };
    expect(markCounts([docA], annotations)).toEqual({ all: 3, highlight: 1, underline: 2, note: 0 });
  });

  it("names a mark so colour is never the only difference between a highlight and an underline", () => {
    expect(kindLabel({ kind: "highlight", color: "green" })).toBe("Highlight (green)");
    expect(kindLabel({ kind: "highlight" })).toBe("Highlight");
    expect(kindLabel({ kind: "underline" })).toBe("Underline");
    expect(kindLabel({ kind: "note" })).toBe("Note");
  });
});
