import { describe, expect, it } from "vitest";
import { LEARN_PAGES, learnPage, learnVisible, publishedLearnPages } from "@/lib/seo/learn";
import { getSample } from "@/lib/content/samples";
import { PDF_LIMITS } from "@/lib/content/limits";
import { quotaFor } from "@/lib/ai/budget";

const words = (p: (typeof LEARN_PAGES)[number]) => [p.intro, ...p.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.points ?? [])])].join(" ").split(/\s+/).length;
const text = (p: (typeof LEARN_PAGES)[number]) => JSON.stringify(p);

describe("the learn pages", () => {
  it("each has its own title (60 characters or fewer), description (70 to 160) and heading", () => {
    for (const p of LEARN_PAGES) {
      expect(p.title.length, p.slug).toBeLessThanOrEqual(60);
      expect(p.description.length, p.slug).toBeGreaterThanOrEqual(70);
      expect(p.description.length, p.slug).toBeLessThanOrEqual(160);
    }
    for (const key of ["slug", "title", "description", "h1"] as const) expect(new Set(LEARN_PAGES.map((p) => p[key])).size, key).toBe(LEARN_PAGES.length);
  });

  it("is real writing, not a template: enough words, several sections with their own headings, and no repeated paragraph across pages", () => {
    for (const p of LEARN_PAGES) {
      expect(words(p), p.slug).toBeGreaterThanOrEqual(350);
      expect(p.sections.length, p.slug).toBeGreaterThanOrEqual(3);
      expect(new Set(p.sections.map((s) => s.heading)).size, p.slug).toBe(p.sections.length);
    }
    const all = LEARN_PAGES.flatMap((p) => p.sections.flatMap((s) => s.paragraphs));
    expect(new Set(all).size).toBe(all.length);
  });

  it("each has a real demonstration: a link into a bundled text that exists", () => {
    for (const p of LEARN_PAGES) {
      const m = /^\/read\/([a-z0-9-]+)$/.exec(p.demo.href);
      expect(m, p.slug).not.toBeNull();
      expect(getSample(m![1]), p.slug).not.toBeNull();
    }
  });

  it("links only to pages that exist", () => {
    for (const p of LEARN_PAGES) for (const r of p.related) expect(learnPage(r), `${p.slug} -> ${r}`).not.toBeNull();
  });

  it("claims nothing the product does not do today", () => {
    const banned = [/semantic search/i, /chrome extension/i, /pocket import|import from pocket/i, /\bunlimited\b/i, /free forever/i, /100%/, /guarantee/i, /\bOCR\b[^.]*\b(reads|supports|handles)\b/i, /instantly/i, /best[- ]in[- ]class|#1\b/i];
    for (const p of LEARN_PAGES) for (const b of banned) expect(text(p), `${p.slug} ${b}`).not.toMatch(b);
  });

  it("states the numbers the code enforces", () => {
    const pdf = learnPage("ai-pdf-reader")!;
    const t = text(pdf);
    expect(t).toContain(`${PDF_LIMITS.pages} pages`);
    expect(t).toContain("25 MB");
    expect(t).toContain("three AI questions a day");
    expect(quotaFor("ai").anon).toBe(3);
    expect(t).toContain("twenty");
    expect(quotaFor("ai").user).toBe(20);
  });

  it("keeps drafts out of production unless previewing, and shows published pages always", () => {
    const draft = { ...LEARN_PAGES[0], status: "draft" as const };
    expect(learnVisible(draft, { NODE_ENV: "production" })).toBe(false);
    expect(learnVisible(draft, { NODE_ENV: "production", GLOSS_LEARN_PREVIEW: "1" })).toBe(true);
    expect(learnVisible(draft, { NODE_ENV: "development" })).toBe(true);
    expect(learnVisible({ ...draft, status: "published" }, { NODE_ENV: "production" })).toBe(true);
  });

  it("nothing is published until the owner says so", () => {
    expect(publishedLearnPages()).toEqual([]);
  });
});
