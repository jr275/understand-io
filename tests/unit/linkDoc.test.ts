import { describe, expect, it } from "vitest";
import { linkDocument, nameFromUrl, pageMeta } from "@/lib/content/linkDoc";

describe("pageMeta", () => {
  it("prefers the page's own social title and description, decoding entities", () => {
    const html = `<html><head><title>Fallback &amp; title</title><meta property="og:title" content="Final OSINT &mdash; tools &#38; guides"><meta name="description" content="plain"><meta property="og:description" content='A "curated" list'><meta property="og:site_name" content="Final OSINT"></head><body>x</body></html>`;
    expect(pageMeta(html)).toEqual({ title: "Final OSINT — tools & guides", description: 'A "curated" list', siteName: "Final OSINT" });
  });
  it("falls back to <title> and the plain description, in either attribute order", () => {
    const html = `<head><TITLE>\n  My   page \n</TITLE><meta content="Said plainly" name="description"></head>`;
    expect(pageMeta(html)).toMatchObject({ title: "My page", description: "Said plainly" });
  });
  it("returns nothing for a page that says nothing, and looks only at the start of a huge page", () => {
    expect(pageMeta("<html><body>hello</body></html>")).toEqual({ title: undefined, description: undefined, siteName: undefined });
    expect(pageMeta("x".repeat(70_000) + "<title>too late</title>").title).toBeUndefined();
  });
  it("bounds what it keeps", () => {
    const m = pageMeta(`<title>${"t".repeat(500)}</title><meta name="description" content="${"d".repeat(900)}">`);
    expect(m.title!.length).toBe(200);
    expect(m.description!.length).toBe(400);
  });
  it("does not choke on hostile numeric entities", () => {
    expect(pageMeta("<title>a &#99999999; b &#x110000; c</title>").title).toBe("a b c");
  });
});

describe("nameFromUrl and linkDocument", () => {
  it("names a link by its host and the last part of its path", () => {
    expect(nameFromUrl("https://www.example.com/")).toBe("example.com");
    expect(nameFromUrl("https://example.com/reports/annual-report-2024.pdf")).toBe("example.com: annual report 2024");
    expect(nameFromUrl("https://finalosint.lat/")).toBe("finalosint.lat");
  });
  it("builds a link document: not readable text, the reason kept inside, what the page said about itself", () => {
    const d = linkDocument({ url: "https://finalosint.lat/", reason: "The page had no readable paragraphs.", meta: { title: "Final OSINT", description: "Tools", siteName: "Final OSINT" } });
    expect(d).toMatchObject({ kind: "link", title: "Final OSINT", dek: "Tools", sourceUrl: "https://finalosint.lat/", sourceLabel: "Final OSINT", paragraphs: 0, minutes: 0 });
    expect(d.blocks).toEqual([{ id: "reason", type: "note", text: "The page had no readable paragraphs." }]);
    expect(d.slug).toMatch(/^final-osint-[a-z0-9]{5}$/);
  });
  it("with nothing known about the page it is named from its address", () => {
    const d = linkDocument({ url: "https://example.org/some/thing", reason: "x" });
    expect(d.title).toBe("example.org: thing");
    expect(d.dek).toBeNull();
    expect(d.sourceLabel).toBe("example.org");
  });
});
