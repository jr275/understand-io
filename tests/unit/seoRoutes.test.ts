import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { generateMetadata as landingMeta } from "@/app/page";
import { generateMetadata as readMeta } from "@/app/read/[slug]/page";
import { generateMetadata as learnMeta } from "@/app/learn/[slug]/page";
import { metadata as libraryMeta } from "@/app/library/page";
import { SAMPLE_META } from "@/lib/content/samples";

vi.mock("@/lib/server/reader", () => ({ getReaderId: async () => null }));

beforeEach(() => vi.stubEnv("APP_URL", "https://understand.example"));
afterEach(() => vi.unstubAllEnvs());

const abs = (p: string) => `https://understand.example${p}`;

describe("robots.txt", () => {
  it("keeps crawlers out of the API and the library, names the sitemap and the host", () => {
    const r = robots();
    expect(r.rules).toEqual([{ userAgent: "*", allow: "/", disallow: ["/api/", "/library"] }]);
    expect(r.sitemap).toBe(abs("/sitemap.xml"));
    expect(r.host).toBe("https://understand.example");
  });
  it("names no sitemap when the public address is not known", () => {
    vi.stubEnv("APP_URL", "");
    expect(robots().sitemap).toBeUndefined();
  });
});

describe("sitemap.xml", () => {
  it("lists the landing page and the bundled samples, and nothing private, draft or unpublished", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toEqual([abs("/"), ...SAMPLE_META.map((s) => abs(`/read/${s.slug}`))]);
    expect(urls.join(" ")).not.toMatch(/library|api|learn|privacy|terms/);
  });
  it("is empty without a public address, and carries no invented dates", () => {
    expect(sitemap().every((e) => e.lastModified === undefined)).toBe(true);
    vi.stubEnv("APP_URL", "");
    expect(sitemap()).toEqual([]);
  });
});

describe("metadata per route", () => {
  it("the landing page has its own title, description, canonical, hreflang and social card", async () => {
    const m = await landingMeta();
    expect(m.title).toEqual({ absolute: "Understand.io: highlight any line and ask it anything" });
    expect(String(m.description).length).toBeGreaterThan(70);
    expect(m.alternates?.canonical).toBe(abs("/"));
    expect(m.alternates?.languages).toMatchObject({ en: abs("/"), "x-default": abs("/") });
    expect(m.openGraph).toMatchObject({ url: abs("/"), siteName: "Understand.io" });
    expect(m.robots).toBeUndefined();
  });

  it("each bundled sample is indexable with its own title, description and canonical address", async () => {
    const seen = new Set<string>();
    for (const s of SAMPLE_META) {
      const m = await readMeta({ params: Promise.resolve({ slug: s.slug }) });
      expect(m.robots).toBeUndefined();
      expect(m.alternates?.canonical).toBe(abs(`/read/${s.slug}`));
      expect(String(m.description)).toMatch(/margin/);
      seen.add(String(m.title));
      seen.add(String(m.description));
    }
    expect(seen.size).toBe(SAMPLE_META.length * 2); // titles and descriptions all differ
  });

  it("a text that is not a sample, or does not exist, says noindex", async () => {
    const m = await readMeta({ params: Promise.resolve({ slug: "someones-private-diary" }) });
    expect(m.robots).toEqual({ index: false, follow: false, nocache: true });
  });

  it("the library says noindex", () => {
    expect(libraryMeta.robots).toEqual({ index: false, follow: false, nocache: true });
  });

  it("a learn page that is still a draft says noindex even when it is being previewed; an unknown one is not shown at all", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const m = await learnMeta({ params: Promise.resolve({ slug: "ai-pdf-reader" }) });
    expect(m.robots).toEqual({ index: false, follow: false, nocache: true });
    expect(m.alternates?.canonical).toBe(abs("/learn/ai-pdf-reader"));
    expect((await learnMeta({ params: Promise.resolve({ slug: "nope" }) })).robots).toEqual({ index: false, follow: false, nocache: true });
    vi.stubEnv("NODE_ENV", "production");
    expect((await learnMeta({ params: Promise.resolve({ slug: "ai-pdf-reader" }) })).title).toBe("Understand.io");
  });
});
