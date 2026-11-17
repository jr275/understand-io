import { DEFAULT_LOCALE, normalizeLocale } from "./config";
import { translate, type Translator } from "./translate";

/**
 * A translator for code that runs in an event handler or a callback rather than in a render (a toast after a click, an error raised by a request):
 * it reads the language the page is in right now (`<html lang>`, which the provider keeps in step), so it needs no hook and no dependency list.
 * Anything that is part of what a component draws uses `useT()` instead.
 */
export const tNow: Translator = (key, vars) => translate(typeof document === "undefined" ? DEFAULT_LOCALE : (normalizeLocale(document.documentElement.lang) ?? DEFAULT_LOCALE), key, vars);

/** The current page language, for the same kind of code (see `tNow`). */
export const currentLocale = () => (typeof document === "undefined" ? DEFAULT_LOCALE : (normalizeLocale(document.documentElement.lang) ?? DEFAULT_LOCALE));

/** The name of a language (`pt`, `es`, `ja`...) in the page's own language: "Portuguese" or "português". */
export function languageDisplay(code: string): string {
  try {
    return new Intl.DisplayNames(currentLocale() === "pt-BR" ? "pt-BR" : "en", { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
