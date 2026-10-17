import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sentences } from "@/lib/search/tokenize";

const split = (t: string) => sentences(t).map((s) => s.text);

describe("sentences(): cases the previous splitter got wrong (decimals, abbreviations, domains)", () => {
  const cases: [string, string, string[]][] = [
    ["decimal and U.S.", "The rate was 3.5 percent in the U.S. last year.", ["The rate was 3.5 percent in the U.S. last year."]],
    ["e.g. / i.e.", "Use fruit, e.g., apples and pears, i.e., things that grow.", ["Use fruit, e.g., apples and pears, i.e., things that grow."]],
    ["domain", "Visit example.com now.", ["Visit example.com now."]],
    ["pH, ellipsis and version", "pH was 7.2—neutral... Version v1.2.3 shipped.", ["pH was 7.2—neutral...", "Version v1.2.3 shipped."]],
    ["Ph.D., Fig. and p.", "Ph.D. students; see Fig. 3 and p. 45.", ["Ph.D. students; see Fig. 3 and p. 45."]],
    ["a.m./p.m. before lowercase", "At 5 p.m. we left.", ["At 5 p.m. we left."]],
    ["ellipsis before lowercase", "Wait... what?", ["Wait... what?"]],
    ["initial after lowercase noun splits", "He took vitamin C. Then he slept.", ["He took vitamin C.", "Then he slept."]],
    ["No. without a number splits", "She said No. He left.", ["She said No.", "He left."]],
    ["No. with a number joins", "See No. 5 for details. Then go.", ["See No. 5 for details.", "Then go."]],
    ["initials in names", "John F. Kennedy and J. K. Rowling met. They talked.", ["John F. Kennedy and J. K. Rowling met.", "They talked."]],
    ["titles and H.M.S.", "Dr. Wallich looked. H.M.S. Bulldog sailed on! Then what?", ["Dr. Wallich looked.", "H.M.S. Bulldog sailed on!", "Then what?"]],
    ["em dash after a full stop", "five per cent.—of it—is of a different nature. Next.", ["five per cent.—of it—is of a different nature.", "Next."]],
    ["closing quotes and brackets", "He said, “Go home.” Then he left. (Really.) Yes.", ["He said, “Go home.”", "Then he left.", "(Really.)", "Yes."]],
    ["footnote markers stay with their sentence", "It ended.[1] Then more.[2] Done.", ["It ended.[1]", "Then more.[2]", "Done."]],
    ["Co. before lowercase", "Harper & Brothers and Redding & Co. to select our reading?", ["Harper & Brothers and Redding & Co. to select our reading?"]],
    ["lowercase interjection continues", "O dear! how some poor unfortunate fared. Fine.", ["O dear! how some poor unfortunate fared.", "Fine."]],
    ["no terminator", "A heading without a full stop", ["A heading without a full stop"]],
    ["empty and whitespace", "   ", []],
  ];
  for (const [name, input, expected] of cases) it(name, () => expect(split(input)).toEqual(expected));

  it("returns offsets that slice back to the sentence text", () => {
    const text = "  First one.  Second one!   Third? ";
    for (const s of sentences(text)) expect(text.slice(s.start, s.end)).toBe(s.text);
    expect(sentences(text).map((s) => s.start)).toEqual([2, 14, 28]); // 2 spaces, "First one." (10 chars), 2 spaces, "Second one!" (11), 3 spaces
  });
});

describe("sentences() on the shipped sample texts", () => {
  for (const file of ["on-a-piece-of-chalk", "on-thinking-for-oneself", "walden-reading"]) {
    const doc = JSON.parse(readFileSync(`src/content/samples/${file}.json`, "utf8")) as { blocks: { type: string; text: string }[] };
    it(`${file}: no sentence starts in lowercase and offsets are exact`, () => {
      for (const b of doc.blocks)
        for (const s of sentences(b.text)) {
          expect(b.text.slice(s.start, s.end), s.text.slice(0, 30)).toBe(s.text);
          expect(s.text, `${file}: "${s.text.slice(0, 40)}"`).not.toMatch(/^\p{Ll}/u);
        }
    });
    it(`${file}: the sentences cover every word of every block`, () => {
      for (const b of doc.blocks) {
        const rebuilt = sentences(b.text).map((s) => s.text).join(" ").replace(/\s+/g, " ");
        expect(rebuilt).toBe(b.text.replace(/\s+/g, " ").trim());
      }
    });
  }
});
