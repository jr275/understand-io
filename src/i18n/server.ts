import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, PUBLIC_HEADER, localeFromAcceptLanguage, normalizeLocale, type Locale } from "./config";
import { translatorFor, type Translator } from "./translate";

/** What a request's language is, from what it carries: the address prefix, then (for the app's own, unindexed pages) the saved choice, then the browser. */
export function resolveLocale(input: { header?: string | null; isPublic?: boolean; cookie?: string | null; acceptLanguage?: string | null }): Locale {
  const fromAddress = normalizeLocale(input.header);
  if (fromAddress) return fromAddress;
  if (input.isPublic) return DEFAULT_LOCALE; // an indexed page has one language per address: Googlebot and a reader must see the same thing there
  return normalizeLocale(input.cookie) ?? localeFromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** The language of the page being rendered (server components, layouts, `generateMetadata`). */
export async function getLocale(): Promise<Locale> {
  const h = await headers();
  const c = await cookies();
  return resolveLocale({ header: h.get(LOCALE_HEADER), isPublic: h.get(PUBLIC_HEADER) === "1", cookie: c.get(LOCALE_COOKIE)?.value, acceptLanguage: h.get("accept-language") });
}

export async function getT(): Promise<Translator> {
  return translatorFor(await getLocale());
}

/** The language of an API request (error messages): the saved choice, then the browser. API answers are never indexed, so there is no address to follow. */
export function requestLocale(req: Request): Locale {
  const cookie = /(?:^|;\s*)gloss_lang=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  return resolveLocale({ cookie: cookie ? decodeURIComponent(cookie) : null, acceptLanguage: req.headers.get("accept-language") });
}
export const requestT = (req: Request): Translator => translatorFor(requestLocale(req));
