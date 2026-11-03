"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, htmlLang, localePath, splitLocalePath, type Locale } from "./config";
import { formatCurrency, formatDate, formatDateTime, formatList, formatNumber, formatPercent, formatRelative } from "./format";
import { translatorFor, type Translator } from "./translate";

interface I18n {
  locale: Locale;
  t: Translator;
  /** Changes the language everywhere at once, remembers the choice, and keeps the page's state (reading position, open document, conversation). */
  setLocale: (l: Locale) => void;
  fmt: { number: (n: number, o?: Intl.NumberFormatOptions) => string; percent: (r: number, digits?: number) => string; currency: (n: number, c: string) => string; date: (d: Date | number | string, o?: Intl.DateTimeFormatOptions) => string; dateTime: (d: Date | number | string) => string; relative: (d: Date | number | string) => string; list: (items: string[]) => string };
}

const Ctx = createContext<I18n | null>(null);

export function rememberLocale(l: Locale) {
  try {
    document.cookie = `${LOCALE_COOKIE}=${l}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    /* cookies blocked: the choice then lasts for this page view only */
  }
}

/**
 * The language of the page, from the server (so the first paint is already right). Choosing another language does not reload the page: the client
 * state stays where it is (a client component keeps its state across `router.refresh()`), only the words change. A page whose address carries the
 * language (the indexed ones) moves to the same page in the other language instead, because that address is what search engines know it by.
 */
export function I18nProvider({ locale: initial, children }: { locale: Locale; children: ReactNode }) {
  const router = useRouter();
  // The server's language wins whenever it changes (a refresh after a choice, a navigation to a page in the other language); between those moments the
  // reader's choice is applied at once, before the server has answered.
  const [state, setState] = useState({ from: initial, locale: initial });
  if (state.from !== initial) setState({ from: initial, locale: initial });
  const locale = state.locale;
  const setLoc = useCallback((l: Locale) => setState((s) => ({ ...s, locale: l })), []);
  useEffect(() => {
    document.documentElement.lang = htmlLang(locale);
  }, [locale]);

  const setLocale = useCallback(
    (l: Locale) => {
      rememberLocale(l);
      setLoc(l);
      const { path } = splitLocalePath(location.pathname);
      const isPublic = path === "/" || path.startsWith("/learn") || path.startsWith("/legal") || path === "/privacy" || path === "/terms";
      if (isPublic) router.push(`${localePath(path, l)}${location.search}`);
      else router.refresh(); // the server-rendered words follow; nothing the reader is doing is lost
    },
    [router, setLoc],
  );

  const value = useMemo<I18n>(
    () => ({
      locale,
      t: translatorFor(locale),
      setLocale,
      fmt: {
        number: (n, o) => formatNumber(locale, n, o),
        percent: (r, d) => formatPercent(locale, r, d),
        currency: (n, c) => formatCurrency(locale, n, c),
        date: (d, o) => formatDate(locale, d, o),
        dateTime: (d) => formatDateTime(locale, d),
        relative: (d) => formatRelative(locale, d),
        list: (items) => formatList(locale, items),
      },
    }),
    [locale, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n needs <I18nProvider> (it is in the root layout)");
  return v;
}
export const useT = (): Translator => useI18n().t;
export const useLocale = (): Locale => useI18n().locale;
