import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentFromPdf, mergeFragmentRuns, textWithParagraphGaps } from "@/lib/content/pdf";

const line = (str: string, y: number) => [{ str, transform: [1, 0, 0, 1, 72, y] }, { str: "", hasEOL: true }];

describe("textWithParagraphGaps", () => {
  it("puts a blank line where the vertical gap is clearly larger than the usual line spacing", () => {
    const items = [...line("Title of the piece", 700), ...line("First paragraph line one", 672), ...line("first paragraph line two.", 660), ...line("Second paragraph.", 632)];
    expect(textWithParagraphGaps(items)).toBe("Title of the piece\n\nFirst paragraph line one\nfirst paragraph line two.\n\nSecond paragraph.");
  });
  it("leaves evenly spaced text alone", () => {
    const items = [...line("one", 700), ...line("two", 688), ...line("three", 676), ...line("four", 664)];
    expect(textWithParagraphGaps(items)).toBe("one\ntwo\nthree\nfour");
  });
  it("copes with items that have no position, and with empty pages", () => {
    expect(textWithParagraphGaps([{ str: "a", hasEOL: true }, { str: "b", hasEOL: true }])).toBe("a\nb");
    expect(textWithParagraphGaps([])).toBe("");
  });
});

describe("a real PDF whose paragraphs are separated by blank lines", () => {
  it("keeps the title and the paragraphs apart (they used to be merged into one block)", async () => {
    const doc = await documentFromPdf(new Uint8Array(readFileSync("tests/fixtures/paragraph-gaps.pdf")), "paragraph-gaps.pdf");
    const texts = doc.blocks.map((b) => b.text);
    expect(texts).toHaveLength(4);
    expect(texts[0]).toBe("Chalk and the history of the earth");
    expect(texts[1]).toMatch(/^Chalk is a soft white limestone/);
    expect(texts[2]).toMatch(/^When a piece of chalk is crushed/);
    expect(texts[3]).toMatch(/^The white cliffs along the south coast/);
  });
});

describe("mergeFragmentRuns (text from figures and tables)", () => {
  const prose = "This is an ordinary paragraph of the paper, long enough to be prose and not a fragment of a figure.";
  it("joins three or more tiny pieces in a row into one block", () => {
    const text = [prose, "The", "Law will", "never be", "perfect ,", prose].join("\n\n");
    expect(mergeFragmentRuns(text).split("\n\n")).toEqual([prose, "The Law will never be perfect ,", prose]);
  });
  it("leaves a heading between paragraphs, and two short pieces in a row, alone", () => {
    const text = [prose, "Abstract", prose, "Conclusion", "References", prose].join("\n\n");
    expect(mergeFragmentRuns(text)).toBe(text);
  });
  it("never counts numbered headings or list items as fragments", () => {
    const text = [prose, "3 Model", "3.1 Encoder", "3.2 Attention", "- one", "- two", "- three", prose].join("\n\n");
    expect(mergeFragmentRuns(text)).toBe(text);
  });
  it("is the identity on text with no short pieces", () => {
    expect(mergeFragmentRuns([prose, prose].join("\n\n"))).toBe([prose, prose].join("\n\n"));
    expect(mergeFragmentRuns("")).toBe("");
  });
});
