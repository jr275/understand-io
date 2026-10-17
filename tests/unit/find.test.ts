import { describe, expect, it } from "vitest";
import { findAll, sections } from "@/lib/search/find";
import type { Block } from "@/lib/content/types";

const B = (id: string, text: string, type: Block["type"] = "p", n?: number): Block => ({ id, type, text, n });

describe("findAll (literal search in the open document)", () => {
  const blocks = [B("p1", "The Chalk is soft. The chalk is white.", "p", 1), B("p2", "Café “Chalk” — over the sea.", "p", 2), B("p3", "No match here at all.", "p", 3)];
  it("finds every occurrence in order, ignoring case, with offsets in the original text", () => {
    const { matches } = findAll(blocks, "chalk");
    expect(matches.map((m) => [m.blockId, blocks.find((b) => b.id === m.blockId)!.text.slice(m.start, m.end)])).toEqual([
      ["p1", "Chalk"],
      ["p1", "chalk"],
      ["p2", "Chalk"],
    ]);
  });
  it("ignores accents and quote or dash style, and returns spans that cover the original characters", () => {
    expect(findAll(blocks, "cafe").matches.map((m) => blocks[1].text.slice(m.start, m.end))).toEqual(["Café"]);
    expect(findAll(blocks, '"chalk"').matches.map((m) => blocks[1].text.slice(m.start, m.end))).toEqual(["“Chalk”"]);
    expect(findAll(blocks, 'chalk" - over').matches.map((m) => blocks[1].text.slice(m.start, m.end))).toEqual(["Chalk” — over"]);
  });
  it("finds phrases across words, and nothing for a phrase that is not there", () => {
    expect(findAll(blocks, "is soft").matches).toHaveLength(1);
    expect(findAll(blocks, "is hard").matches).toEqual([]);
  });
  it("counts any run of whitespace, line breaks and tabs as one space, and keeps offsets in the original text", () => {
    const t = "first line\nsecond   line\tend";
    const find = (q: string) => findAll([B("p1", t, "pre", 1)], q).matches.map((m) => t.slice(m.start, m.end));
    expect(find("first line second")).toEqual(["first line\nsecond"]);
    expect(find("second line end")).toEqual(["second   line\tend"]);
    expect(find("line   end")).toEqual(["line\tend"]);
    expect(find("secondline")).toEqual([]); // no space at all is not the same word break
  });
  it("needs at least two characters", () => {
    expect(findAll(blocks, "").matches).toEqual([]);
    expect(findAll(blocks, "c").matches).toEqual([]);
    expect(findAll(blocks, "   ").matches).toEqual([]);
  });
  it("does not overlap matches of the same word and treats regex characters literally", () => {
    expect(findAll([B("p1", "aaaa", "p", 1)], "aa").matches).toHaveLength(2);
    expect(findAll([B("p1", "cost (3.5%) and [x]", "p", 1)], "(3.5%)").matches).toHaveLength(1);
    expect(findAll([B("p1", "cost 3x5", "p", 1)], "3.5").matches).toHaveLength(0);
  });
  it("skips figures and handles emoji without cutting them", () => {
    const b = [B("f1", "chalk", "figure"), B("p1", "I 🙂 chalk 🙂 chalk", "p", 1)];
    const { matches } = findAll(b, "chalk");
    expect(matches).toHaveLength(2);
    expect(b[1].text.slice(matches[0].start, matches[0].end)).toBe("chalk");
  });
  it("stops at a bound and says so", () => {
    const big = [B("p1", "ab ".repeat(5000), "p", 1)];
    const r = findAll(big, "ab");
    expect(r.matches.length).toBe(2000);
    expect(r.truncated).toBe(true);
  });
});

describe("sections", () => {
  it("lists headings with the first paragraph after each", () => {
    const s = sections([B("h1", "Intro", "h2"), B("p1", "x", "p", 1), B("h2", "Detail", "h3"), B("p2", "y", "p", 2), B("e", "  ", "h2")]);
    expect(s).toEqual([
      { blockId: "h1", title: "Intro", level: 2, n: 1 },
      { blockId: "h2", title: "Detail", level: 3, n: 2 },
    ]);
  });
  it("is empty when there are no headings", () => {
    expect(sections([B("p1", "x", "p", 1)])).toEqual([]);
  });
});
