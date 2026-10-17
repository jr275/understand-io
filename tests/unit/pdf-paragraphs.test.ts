import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentFromPdf, textWithParagraphGaps } from "@/lib/content/pdf";

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
