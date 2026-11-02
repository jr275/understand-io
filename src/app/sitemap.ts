import type { MetadataRoute } from "next";
import { SAMPLE_META } from "@/lib/content/samples";
import { legalLinks } from "@/lib/legal/docs";
import { publishedLearnPages } from "@/lib/seo/learn";
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
  const paths = ["/", ...SAMPLE_META.map((s) => `/read/${s.slug}`), ...publishedLearnPages().map((p) => `/learn/${p.slug}`), ...legalLinks().map((l) => l.href)];
  return paths.map((p) => ({ url: absoluteUrl(p) }));
}
