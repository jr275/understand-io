import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEGAL_DOCS, LEGAL_LANGS, asLang, forgetLegalCache, legalFlagOn, legalLinks, legalStatus, openItems, resolveLegal, type LegalDoc } from "@/lib/legal/docs";
import { Markdown } from "@/lib/legal/markdown";

afterEach(() => {
  vi.unstubAllEnvs();
  forgetLegalCache();
});

const html = (md: string) => renderToStaticMarkup(createElement(Markdown, { source: md }));
const ON = { GLOSS_LEGAL_PUBLISHED: "1" };
const finalText = (name: string) => `# ${name}\n\nAll decided.`;
const files = (over: Record<string, string | null> = {}) => (name: string) => (name in over ? over[name] : finalText(name));

describe("when a legal text may be shown", () => {
  it("never, unless the operator has switched publication on", () => {
    expect(legalFlagOn({})).toBe(false);
    for (const off of ["", "0", "false", "no", "off", "maybe"]) expect(legalFlagOn({ GLOSS_LEGAL_PUBLISHED: off })).toBe(false);
    for (const on of ["1", "true", "YES", " on "]) expect(legalFlagOn({ GLOSS_LEGAL_PUBLISHED: on })).toBe(true);
    expect(resolveLegal("privacy", "en", { env: {}, read: files() })).toEqual({ ok: false, reason: "off" });
    expect(legalLinks({ env: {}, read: files() })).toEqual([]);
  });

  it("not while any ⚠️ marker is left in either language: a draft is never shown, even in the language that happens to be clean", () => {
    const draft = files({ "privacy-policy.pt-BR.md": "# Política\n\n⚠️ [DECISÃO DO PROPRIETÁRIO: nome]" });
    expect(resolveLegal("privacy", "en", { env: ON, read: draft })).toEqual({ ok: false, reason: "open-items" });
    expect(resolveLegal("privacy", "pt", { env: ON, read: draft })).toEqual({ ok: false, reason: "open-items" });
    expect(resolveLegal("terms", "en", { env: ON, read: draft }).ok).toBe(true); // another text is judged on its own
  });

  it("not when a language version is missing", () => {
    expect(resolveLegal("terms", "en", { env: ON, read: files({ "terms-of-use.pt-BR.md": null }) })).toEqual({ ok: false, reason: "missing" });
  });

  it("when switched on and final in both languages: the text, in the language asked for", () => {
    const r = resolveLegal("terms", "pt", { env: ON, read: files() });
    expect(r).toEqual({ ok: true, lang: "pt", markdown: finalText("terms-of-use.pt-BR.md") });
    const e = resolveLegal("terms", "en", { env: ON, read: files() });
    expect(e.ok && e.markdown).toBe(finalText("terms-of-use.en.md"));
  });

  it("the footer links appear only when both the privacy policy and the terms may be shown", () => {
    expect(legalLinks({ env: ON, read: files() })).toEqual([
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ]);
    expect(legalLinks({ env: ON, read: files({ "terms-of-use.en.md": "⚠️ open" }) })).toEqual([]); // one of the two is a draft: neither is linked
  });

  it("counts the open items, and an unknown language falls back to English", () => {
    expect(openItems("a ⚠️ b ⚠️ c")).toBe(2);
    expect(openItems("final")).toBe(0);
    expect([asLang("pt"), asLang("pt-BR"), asLang("fr"), asLang(undefined)]).toEqual(["pt", "pt", "en", "en"]);
  });

  it("DATA: the drafts in docs/legal exist in both languages, and every text that still has a ⚠️ is held back when publication is on", () => {
    const status = legalStatus();
    expect(status).toHaveLength(Object.keys(LEGAL_DOCS).length * LEGAL_LANGS.length);
    expect(status.every((s) => s.open !== "missing")).toBe(true);
    for (const doc of Object.keys(LEGAL_DOCS) as LegalDoc[]) {
      const open = status.filter((s) => s.doc === doc).some((s) => s.open !== 0);
      expect(resolveLegal(doc, "en", { env: ON }).ok).toBe(!open);
    }
  });
});

describe("the markdown renderer", () => {
  it("renders headings, paragraphs, bold, italics and code as markup, and nothing as raw HTML", () => {
    const out = html("# Title\n\n## Part\n\nSome **bold**, *italic* and `code` here.\n\n<script>alert(1)</script> <b>x</b>");
    expect(out).toContain("<h1");
    expect(out).toContain("<h2");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("code</code>");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("removes every note for the owner, on one line or several", () => {
    const out = html("Before\n\n<!-- NOTE: one line -->\n\n<!--\nNOTE: several\nlines\n-->\n\nAfter");
    expect(out).not.toMatch(/NOTE|<!--|-->/);
    expect(out).toContain("Before");
    expect(out).toContain("After");
  });

  it("renders nested bullet lists, numbered lists and wrapped list lines", () => {
    const out = html("- one\n  - nested a\n  - nested b\n- two continues\n  on the next line\n\n1. first\n2. second");
    expect((out.match(/<ul/g) ?? []).length).toBe(2);
    expect(out).toContain("<ol");
    expect(out).toContain("two continues on the next line");
    expect(out.indexOf("nested a")).toBeGreaterThan(out.indexOf("one"));
    expect(out.indexOf("nested a")).toBeLessThan(out.indexOf("two continues"));
  });

  it("renders tables with a header row, and block quotes", () => {
    const out = html("| Data | Where |\n| --- | --- |\n| Library | **Neon** |\n\n> quoted words");
    expect(out).toContain("<table");
    expect(out).toContain('scope="col"');
    expect(out).toContain("<strong>Neon</strong>");
    expect(out).toContain("<blockquote");
    expect(out).not.toContain("---");
  });

  it("keeps a link only when it is http(s), mailto, an anchor or a path on this site", () => {
    const out = html("[ok](https://example.org/a) [mail](mailto:a@b.co) [here](/terms) [top](#top) [bad](javascript:alert(1)) [bad2](//evil.example/x) [data](data:text/html,x)");
    expect(out).toContain('href="https://example.org/a"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="mailto:a@b.co"');
    expect(out).toContain('href="/terms"');
    expect(out).toContain('href="#top"');
    expect(out).not.toMatch(/href="javascript|href="\/\/evil|href="data:/);
    expect(out).toContain("bad");
  });

  it("DATA: every real draft renders with no markup left over (no raw ** or <!--), and every table and heading in the source comes out", () => {
    const dir = "docs/legal";
    const names = readdirSync(dir).filter((n) => /\.(en|pt-BR)\.md$/.test(n));
    expect(names.length).toBe(Object.keys(LEGAL_DOCS).length * 2);
    for (const n of names) {
      const src = readFileSync(`${dir}/${n}`, "utf8");
      const out = html(src);
      const text = out.replace(/<[^>]+>/g, "");
      expect(text, n).not.toContain("**");
      expect(text, n).not.toContain("<!--");
      expect(text, n).not.toMatch(/NOTE FOR OWNER|NOTA PARA O PROPRIET/);
      const headings = (src.replace(/<!--[\s\S]*?-->/g, "").match(/^#{1,4} /gm) ?? []).length;
      expect((out.match(/<h[1-4]/g) ?? []).length, n).toBe(headings);
      const tables = (src.replace(/<!--[\s\S]*?-->/g, "").match(/^\|[^\n]*\n\| ?[-: |]+\|?\n/gm) ?? []).length;
      expect((out.match(/<table/g) ?? []).length, n).toBe(tables);
    }
  });
});
