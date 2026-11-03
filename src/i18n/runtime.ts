import { DEFAULT_LOCALE, normalizeLocale } from "./config";
import { translate, type Translator } from "./translate";

/**
 * A translator for code that runs in an event handler or a callback rather than in a render (a toast after a click, an error raised by a request):
 * it reads the language the page is in right now (`<html lang>`, which the provider keeps in step), so it needs no hook and no dependency list.
 * Anything that is part of what a component draws uses `useT()` instead.
 */
export const tNow: Translator = (key, vars) => translate(typeof document === "undefined" ? DEFAULT_LOCALE : (normalizeLocale(document.documentElement.lang) ?? DEFAULT_LOCALE), key, vars);
