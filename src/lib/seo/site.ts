import type { Metadata } from "next";

/**
 * Everything about how the site presents itself to search engines and social cards, in one place: the public origin, the languages a page
 * really exists in, and the canonical and `hreflang` addresses that follow from them. The rule that keeps this honest: an alternate language is
 * declared only for a page that exists in that language (`available`), so no `hreflang` ever points at a page that is not there.
 */

export const SITE_NAME = "Keeple";

/** The public origin, from `APP_URL` (so the address changes with the domain, never with a code change); undefined in previews and local work. */
export function siteOrigin(env: Record<string, string | undefined> = process.env): URL | undefined {
  try {
    return env.APP_URL ? new URL(env.APP_URL) : undefined;
  } catch {
    return undefined;
  }
}

/** The languages the product is published in: the code `hreflang` uses and the label a reader sees. Add one here only with real pages behind it. */
export const LOCALES = {
  en: { hreflang: "en", label: "English" },
  "pt-BR": { hreflang: "pt-BR", label: "Português (Brasil)" },
} as const;
export type Locale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: Locale = "en";

export interface PageLanguages {
  /** The site path of the page in each language it exists in (`{ en: "/", "pt-BR": "/pt" }`). A language that is absent here has no page and gets no `hreflang`. */
  [locale: string]: string;
}

/** The absolute address of a site path, or the path itself when the origin is not known. */
export const absoluteUrl = (path: string, origin: URL | undefined = siteOrigin()) => (origin ? new URL(path, origin).toString() : path);

/**
 * `alternates` for one page: its canonical address and, for each language it exists in, an `hreflang` entry (plus `x-default`, the default
 * language's page). Without a public origin there is nothing absolute to declare, so nothing is.
 */
export function alternatesFor(path: string, languages: PageLanguages = { [DEFAULT_LOCALE]: path }, origin: URL | undefined = siteOrigin()): Metadata["alternates"] {
  if (!origin) return undefined;
  const entries = Object.entries(languages).filter(([l]) => l in LOCALES);
  const map: Record<string, string> = {};
  for (const [l, p] of entries) map[LOCALES[l as Locale].hreflang] = absoluteUrl(p, origin);
  const fallback = languages[DEFAULT_LOCALE];
  if (fallback) map["x-default"] = absoluteUrl(fallback, origin);
  return { canonical: absoluteUrl(path, origin), ...(Object.keys(map).length ? { languages: map } : {}) };
}

/** Open Graph and Twitter fields for a page, with its own title, description and address (the image comes from `opengraph-image`). */
export function socialFor(o: { title: string; description: string; path: string; type?: "website" | "article"; locale?: Locale }, origin: URL | undefined = siteOrigin()): Pick<Metadata, "openGraph" | "twitter"> {
  // The English card is the file `app/opengraph-image`; another language has its own card, so a shared Portuguese page does not show an English one.
  const card = o.locale && o.locale !== DEFAULT_LOCALE ? [{ url: absoluteUrl(`/og/${o.locale}`, origin), width: 1200, height: 630 }] : undefined;
  return {
    openGraph: { title: o.title, description: o.description, siteName: SITE_NAME, type: o.type ?? "website", ...(o.locale ? { locale: o.locale === "pt-BR" ? "pt_BR" : "en_US" } : {}), ...(origin ? { url: absoluteUrl(o.path, origin) } : {}), ...(card ? { images: card } : {}) },
    twitter: { card: "summary_large_image", title: o.title, description: o.description, ...(card ? { images: card } : {}) },
  };
}

/** What a page that must not appear in search results says (private reading, the library, a draft). */
export const NOINDEX: Metadata["robots"] = { index: false, follow: false, nocache: true };

/** JSON-LD as the text of a script element: `<` is escaped so no string inside it can end the element. */
export const jsonLd = (data: Record<string, unknown>) => JSON.stringify(data).replace(/</g, "\\u003c");
