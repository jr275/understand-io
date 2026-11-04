import { describe, expect, it } from "vitest";
import { LOCALES, NOINDEX, absoluteUrl, alternatesFor, jsonLd, siteOrigin, socialFor } from "@/lib/seo/site";
import { legalMetadata } from "@/lib/seo/legal";

const origin = new URL("https://understand.example");

describe("site origin", () => {
  it("follows APP_URL and is absent when it is missing or malformed", () => {
    expect(siteOrigin({ APP_URL: "https://understand.example" })?.origin).toBe("https://understand.example");
    expect(siteOrigin({})).toBeUndefined();
    expect(siteOrigin({ APP_URL: "not a url" })).toBeUndefined();
  });
  it("makes addresses absolute only when it can", () => {
    expect(absoluteUrl("/learn/x", origin)).toBe("https://understand.example/learn/x");
    expect(absoluteUrl("/learn/x", undefined)).toBe("/learn/x");
  });
});

describe("canonical and hreflang", () => {
  it("gives a one-language page its own canonical, its own language and x-default", () => {
    expect(alternatesFor("/", undefined, origin)).toEqual({ canonical: "https://understand.example/", languages: { en: "https://understand.example/", "x-default": "https://understand.example/" } });
  });
  it("lists a language only where that page exists in it", () => {
    const a = alternatesFor("/privacy", { en: "/privacy", "pt-BR": "/privacy?lang=pt" }, origin);
    expect(a?.languages).toEqual({ en: "https://understand.example/privacy", "pt-BR": "https://understand.example/privacy?lang=pt", "x-default": "https://understand.example/privacy" });
    expect(alternatesFor("/learn/x", { en: "/learn/x" }, origin)?.languages).not.toHaveProperty("pt-BR");
    expect(Object.keys(alternatesFor("/x", { fr: "/fr/x", en: "/x" }, origin)?.languages ?? {})).not.toContain("fr"); // not a published language
  });
  it("declares nothing without a public address", () => {
    expect(alternatesFor("/", undefined, undefined)).toBeUndefined();
  });
  it("gives each legal language its own canonical", () => {
    expect(legalMetadata("privacy", "pt").title).toBe("Política de Privacidade");
    expect(Object.keys(LOCALES)).toEqual(["en", "pt-BR"]);
  });
});

describe("social cards and structured data", () => {
  it("carries the page's own title, description and address", () => {
    const s = socialFor({ title: "T", description: "D", path: "/learn/x", type: "article" }, origin);
    expect(s.openGraph).toMatchObject({ title: "T", description: "D", type: "article", url: "https://understand.example/learn/x", siteName: "Keeple" });
    expect(s.twitter).toMatchObject({ card: "summary_large_image", title: "T" });
  });
  it("escapes < in JSON-LD so no string can end the script element", () => {
    const out = jsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
  it("noindex is a complete refusal", () => {
    expect(NOINDEX).toEqual({ index: false, follow: false, nocache: true });
  });
});
