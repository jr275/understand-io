import { describe, expect, it } from "vitest";
import { blocksFromText, documentFromText } from "@/lib/content/text";
import { blocksFromArticleHtml, extractArticle } from "@/lib/content/extract";
import { rebuildParagraphs } from "@/lib/content/pdf";
import { speechSegments } from "@/lib/speech/segments";
import { slugFor } from "@/lib/content/slug";

describe("text → blocks", () => {
  it("numbers paragraphs and skips headings", () => {
    const b = blocksFromText("# Title\n\nFirst para.\n\n## Part two\n\nSecond *para* here.\n\n- one\n- two\n\n> quoted");
    expect(b.map((x) => x.type)).toEqual(["h2", "p", "h2", "p", "li", "li", "quote"]);
    expect(b.filter((x) => x.n).map((x) => x.n)).toEqual([1, 2, 3, 4, 5]);
    expect(b[3].runs?.some((r) => r.em)).toBe(true);
  });
  it("lifts a leading heading into the title", () => {
    const d = documentFromText("# My Essay\n\nBody text here that is long enough.");
    expect(d.title).toBe("My Essay");
    expect(d.blocks[0].text).toMatch(/^Body/);
    expect(d.slug).toMatch(/^my-essay-[a-z0-9]{5}$/);
  });
});

describe("html → blocks", () => {
  it("splits <br><br> separated text into paragraphs", () => {
    const b = blocksFromArticleHtml("<div><font>First paragraph here.<br><br>Second <i>italic</i> paragraph.</font></div>");
    expect(b.map((x) => x.text)).toEqual(["First paragraph here.", "Second italic paragraph."]);
    expect(b[1].runs?.find((r) => r.em)?.text).toBe("italic");
  });
  it("keeps headings, lists, quotes and figures", () => {
    const b = blocksFromArticleHtml('<h2>Head</h2><p>One.</p><ul><li>a</li><li>b</li></ul><blockquote><p>q</p></blockquote><figure><img src="/x.png"><figcaption>cap</figcaption></figure>', "https://ex.com/a");
    expect(b.map((x) => x.type)).toEqual(["h2", "p", "li", "li", "quote", "figure"]);
    expect(b[5].src).toBe("https://ex.com/x.png");
  });
  it("extracts an article with Readability", () => {
    const html = `<html><head><title>Chalk Facts</title></head><body><nav>menu menu</nav><article><h1>Chalk Facts</h1><p class="byline">By Ada</p>${"<p>Chalk is a soft white porous sedimentary carbonate rock composed of the mineral calcite.</p>".repeat(6)}</article></body></html>`;
    const x = extractArticle(html, "https://example.org/chalk");
    expect(x.title).toBe("Chalk Facts");
    expect(x.blocks.length).toBeGreaterThanOrEqual(6);
  });
  it("throws when there is no article", () => {
    expect(() => extractArticle("<html><body><div>hi</div></body></html>", "https://example.org/")).toThrow();
  });
});

describe("pdf paragraph rebuild", () => {
  it("joins wrapped lines and keeps blank-line breaks", () => {
    const out = rebuildParagraphs("First line of a para-\ngraph continues here.\n\nSecond para.\n12\n");
    expect(out).toBe("First line of a paragraph continues here.\n\nSecond para.");
  });
});

describe("speech segments", () => {
  const blocks = blocksFromText("Hello there. Second sentence!\n\n## Heading\n\nAnother one. And more.");
  it("yields one segment per sentence in order", () => {
    expect(speechSegments(blocks).map((s) => s.text)).toEqual(["Hello there.", "Second sentence!", "Heading", "Another one.", "And more."]);
  });
  it("clips to a range", () => {
    const segs = speechSegments(blocks, { b: "p1", o: 13 }, { b: "p2", o: 12 });
    expect(segs.map((s) => s.text)).toEqual(["Second sentence!", "Heading", "Another one."]);
  });
});

describe("slug", () => {
  it("is url-safe", () => {
    expect(slugFor("Ética & Café: O Guia!")).toMatch(/^etica-cafe-o-guia-[a-z0-9]{5}$/);
  });
});
