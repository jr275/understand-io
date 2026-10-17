import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderGlossBody } from "@/components/reader/glossMarkdown";

const html = (text: string, valid: Set<number> | null) => renderToStaticMarkup(renderGlossBody(text, () => {}, false, valid) as never);

describe("gloss citations are checked against what the model was given", () => {
  it("links a citation to a paragraph the model saw", () => {
    const out = html("It says so ¶2.", new Set([2, 3]));
    expect(out).toContain('aria-label="Jump to paragraph 2"');
    expect(out).not.toContain("data-unverified");
  });
  it("shows a citation to a paragraph it was never given as unverified, and does not link it", () => {
    const out = html("It says so ¶2 and also ¶60.", new Set([2]));
    expect(out).toContain('aria-label="Jump to paragraph 2"');
    expect(out).toContain('data-unverified="60"');
    expect(out).not.toContain('aria-label="Jump to paragraph 60"');
    expect(out).toContain("cannot be checked");
  });
  it("checks every citation form: (¶3), [¶4], ¶ 5", () => {
    const out = html("a (¶3) b [¶4] c ¶ 5", new Set([3]));
    expect(out).toContain('aria-label="Jump to paragraph 3"');
    expect(out).toContain('data-unverified="4"');
    expect(out).toContain('data-unverified="5"');
  });
  it("leaves every citation linked when it is not known which paragraphs were given (older answers)", () => {
    const out = html("¶2 and ¶60", null);
    expect(out).toContain('aria-label="Jump to paragraph 60"');
    expect(out).not.toContain("data-unverified");
  });
  it("turns the model's own labels into badges", () => {
    const out = html("The author says X ¶2. My reading: this means Y. Outside the text: Z is known from elsewhere. The text does not say: W.", new Set([2]));
    expect(out).toContain('data-basis="My reading"');
    expect(out).toContain('data-basis="Outside the text"');
    expect(out).toContain('data-basis="The text does not say"');
  });
  it("citations inside bold and key sentences are checked too", () => {
    const out = html("==The key point ¶9== and **bold ¶2**", new Set([2]));
    expect(out).toContain('data-unverified="9"');
    expect(out).toContain('aria-label="Jump to paragraph 2"');
  });
});
