import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/seo/site";

/**
 * The product's languages. The list itself lives with the SEO declarations (`lib/seo/site.ts`) so that a language exists in exactly one place: this
 * module adds how a visitor's language is found (the address, the saved choice, the browser's Accept-Language) and how it is remembered.
 */
export { DEFAULT_LOCALE, LOCALES, type Locale };
export const LOCALE_LIST = Object.keys(LOCALES) as Locale[];

/** The cookie that holds the reader's explicit choice. It is set only when the reader chooses (never by detection), lasts a year and holds nothing else. */
export const LOCALE_COOKIE = "gloss_lang";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** Set by the proxy on requests whose address carries a language prefix (`/pt-BR/...`), so the page is rendered in the language of its address. */
export const LOCALE_HEADER = "x-gloss-locale";
/** Set by the proxy: "1" on the pages search engines index (landing, learn, legal), whose language is the language of their address. */
export const PUBLIC_HEADER = "x-gloss-public";
/** The address prefix of every language but the default, which stays where it always was (existing addresses never change). */
export const PREFIX: Record<Locale, string> = { en: "", "pt-BR": "/pt-BR" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && v in LOCALES;

/** Any reasonable spelling of a language (`pt`, `pt_br`, `PT-br`, `en-GB`) as one of ours, or null. Portuguese of any region is Brazilian Portuguese here. */
export function normalizeLocale(raw: string | null | undefined): Locale | null {
  const s = (raw ?? "").trim().toLowerCase().replace("_", "-");
  if (!s) return null;
  if (s === "pt" || s.startsWith("pt-")) return "pt-BR";
  if (s === "en" || s.startsWith("en-")) return "en";
  return null;
}

/** The best of ours for an Accept-Language header (`pt-BR,pt;q=0.9,en;q=0.8`), by quality; null when it names neither. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.map((p) => p.trim()).find((p) => p.startsWith("q="))?.slice(2) ?? "1");
      return { tag, q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const l = normalizeLocale(tag);
    if (l) return l;
  }
  return null;
}

/** `/pt-BR/library` -> `{ locale: "pt-BR", path: "/library" }`; any other address is the default language's, unchanged. */
export function splitLocalePath(pathname: string): { locale: Locale; path: string } {
  for (const l of LOCALE_LIST) {
    const p = PREFIX[l];
    if (p && (pathname === p || pathname.startsWith(`${p}/`))) return { locale: l, path: pathname.slice(p.length) || "/" };
  }
  return { locale: DEFAULT_LOCALE, path: pathname };
}

/** The address of a site path in a language (`("/library", "pt-BR")` -> `/pt-BR/library`; the default language keeps the bare path). */
export const localePath = (path: string, locale: Locale) => (PREFIX[locale] ? `${PREFIX[locale]}${path === "/" ? "" : path}` || PREFIX[locale] : path);

export const htmlLang = (locale: Locale) => LOCALES[locale].hreflang;
export const ogLocale = (locale: Locale) => (locale === "pt-BR" ? "pt_BR" : "en_US");
