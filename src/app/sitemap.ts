import type { MetadataRoute } from "next";
import { SAMPLE_META } from "@/lib/content/samples";
import { legalLinks } from "@/lib/legal/docs";
import { publishedLearnPages } from "@/lib/seo/learn";
import { localePath } from "@/i18n/config";
import { absoluteUrl, siteOrigin } from "@/lib/seo/site";

/**
 * Only what may be found: the landing page, the bundled sample texts (public-domain essays that show the product), the published learn pages and,
 * once the operator has published them, the legal texts. Never the library, a reader's own texts, a draft, or the API. No `lastModified` is
 * written: nothing here knows when a page last changed, and a made-up date is worse than none.
 * Read at request time because the legal pages and the public address are settings of the running service.
 */
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!siteOrigin()) return []; // an address-less sitemap would list pages nobody can reach
  // Pages that exist in both languages are listed once per language, each naming the other as its alternate; the rest (learn articles and sample texts, which are written in English) in English only: no alternate is declared for a page that does not exist.
  const bilingual = ["/", ...legalLinks().map((l) => l.href)];
  const englishOnly = [...publishedLearnPages().map((p) => `/learn/${p.slug}`), ...SAMPLE_META.map((s) => `/read/${s.slug}`)];
  const both = bilingual.flatMap((p) =>
    (["en", "pt-BR"] as const).map((l) => ({ url: absoluteUrl(localePath(p, l)), alternates: { languages: { en: absoluteUrl(localePath(p, "en")), "pt-BR": absoluteUrl(localePath(p, "pt-BR")) } } })),
  );
  return [...both, ...englishOnly.map((p) => ({ url: absoluteUrl(p) }))];
}
