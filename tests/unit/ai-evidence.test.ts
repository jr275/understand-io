import { describe, expect, it } from "vitest";
import { checkItems, findQuote, verifyEvidence } from "@/lib/ai/evidence";
import type { Block } from "@/lib/content/types";

const block = (id: string, text: string, n?: number): Block => ({ id, type: "p", n, text });
const map = (...bs: Block[]) => new Map(bs.map((b) => [b.id, b]));

describe("findQuote", () => {
  const text = "The “great chapter” of the history of the world is written in the chalk — and it is long.";
  it("finds an exact quote and returns the document's own span", () => {
    const hit = findQuote(text, "history of the world is written in the chalk")!;
    expect(text.slice(hit.start, hit.end)).toBe("history of the world is written in the chalk");
  });
  it("forgives case, spacing, quote style and dash style", () => {
    const a = findQuote(text, '"great chapter" of the HISTORY   of the world')!;
    expect(text.slice(a.start, a.end)).toBe("“great chapter” of the history of the world");
    const b = findQuote(text, "chalk - and it is long")!;
    expect(text.slice(b.start, b.end)).toBe("chalk — and it is long");
  });
  it("ignores a leading or trailing ellipsis the model adds", () => {
    const hit = findQuote(text, "…of the world is written in the chalk…")!;
    expect(text.slice(hit.start, hit.end)).toBe("of the world is written in the chalk");
  });
  it("refuses quotes that are not there, too short, or too long", () => {
    expect(findQuote(text, "the history of the world is written in the sea")).toBeNull();
    expect(findQuote(text, "the chalk")).toBeNull(); // 9 characters: matches almost anywhere, proves nothing
    expect(findQuote("x".repeat(2000), "x".repeat(700))).toBeNull();
  });
  it("treats regex characters in the quote literally", () => {
    const t = "Costs rose (by about 3.5%) in the second year of the study.";
    const hit = findQuote(t, "rose (by about 3.5%) in the second")!;
    expect(t.slice(hit.start, hit.end)).toBe("rose (by about 3.5%) in the second");
    expect(findQuote(t, "rose (by about 3x5%) in the second")).toBeNull();
  });
});

describe("verifyEvidence", () => {
  const blocks = map(block("p1", "Alpha beta gamma delta epsilon zeta eta theta.", 1), block("p2", "Iota kappa lambda mu nu xi omicron pi rho.", 2));
  it("keeps only quotes that are really in the named block, with offsets from the document", () => {
    const ev = verifyEvidence(
      [
        { id: "p1", quote: "beta gamma delta epsilon" },
        { id: "p1", quote: "invented words that are not there" },
        { id: "p2", quote: "alpha beta gamma delta" }, // real words, but in another block
        { id: "p9", quote: "kappa lambda mu nu xi omicron" }, // block does not exist
      ],
      blocks,
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ blockId: "p1", n: 1, quote: "beta gamma delta epsilon" });
    expect(blocks.get("p1")!.text.slice(ev[0].start, ev[0].end)).toBe(ev[0].quote);
  });
  it("only accepts blocks the model was shown", () => {
    const ev = verifyEvidence([{ id: "p2", quote: "kappa lambda mu nu xi omicron" }], blocks, new Set(["p1"]));
    expect(ev).toEqual([]);
  });
  it("does not repeat the same span", () => {
    const ev = verifyEvidence([{ id: "p1", quote: "beta gamma delta epsilon" }, { id: "p1", quote: "BETA gamma delta epsilon" }], blocks);
    expect(ev).toHaveLength(1);
  });
});

describe("checkItems: what the text says needs a verified quote", () => {
  const blocks = map(block("p1", "Alpha beta gamma delta epsilon zeta eta theta.", 1));
  it("keeps a supported statement as text", () => {
    const [it0] = checkItems([{ text: "S", basis: "text", evidence: [{ id: "p1", quote: "gamma delta epsilon zeta" }] }], blocks);
    expect(it0.basis).toBe("text");
    expect(it0.evidence).toHaveLength(1);
    expect(it0.unverified).toBeUndefined();
  });
  it("downgrades a claimed-text statement with no verifiable quote to flagged interpretation", () => {
    const [it0, it1] = checkItems(
      [
        { text: "S", basis: "text", evidence: [{ id: "p1", quote: "made up quotation here" }] },
        { text: "T" }, // no basis given counts as a claim of text
      ],
      blocks,
    );
    for (const it of [it0, it1]) {
      expect(it.basis).toBe("interpretation");
      expect(it.unverified).toBe(true);
      expect(it.evidence).toEqual([]);
    }
  });
  it("leaves interpretation as interpretation (not flagged) and external without evidence", () => {
    const [a, b] = checkItems([{ text: "I", basis: "interpretation" }, { text: "E", basis: "external", evidence: [{ id: "p1", quote: "gamma delta epsilon zeta" }] }], blocks);
    expect(a).toMatchObject({ basis: "interpretation", evidence: [] });
    expect(a.unverified).toBeUndefined();
    expect(b).toMatchObject({ basis: "external", evidence: [] });
  });
});
