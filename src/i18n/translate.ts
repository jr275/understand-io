import type { Locale } from "./config";
import { en } from "./messages/en";
import { ptBR } from "./messages/pt-BR";
import type { Messages } from "./messages/types";

/** A message is a string, or `{ one, other }` for a count (plural rules come from `Intl.PluralRules`, so languages with other plurals work unchanged). */
export type Message = string | { one: string; other: string };
export type Vars = Record<string, string | number>;

/** Every key of the dictionary as a dotted path (`library.empty.title`), so a mistyped key does not compile. */
type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Paths<T> = T extends Message ? never : { [K in keyof T & string]: T[K] extends Message ? K : Join<K, Paths<T[K]>> }[keyof T & string];
export type MessageKey = Paths<Messages>;

const DICTS: Record<Locale, Messages> = { en, "pt-BR": ptBR };
const rules = new Map<Locale, Intl.PluralRules>();

function lookup(dict: unknown, key: string): Message | undefined {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as object)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === "string" || (cur && typeof cur === "object" && "other" in (cur as object)) ? (cur as Message) : undefined;
}

/** Fills `{name}` placeholders. A placeholder with no value is left visible (a missing variable is a bug that should show, not vanish). */
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

/**
 * The text for `key` in `locale`. A key missing in Portuguese falls back to English (the product never shows a key); the coverage tests make sure
 * that fallback never happens for a key that exists in English.
 */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const msg = lookup(DICTS[locale], key) ?? lookup(DICTS.en, key);
  if (msg === undefined) return key;
  if (typeof msg === "string") return fill(msg, vars);
  let r = rules.get(locale);
  if (!r) rules.set(locale, (r = new Intl.PluralRules(locale)));
  const n = Number(vars?.n ?? 0);
  return fill(r.select(n) === "one" ? msg.one : msg.other, vars);
}

export type Translator = (key: MessageKey, vars?: Vars) => string;
export const translatorFor = (locale: Locale): Translator => (key, vars) => translate(locale, key, vars);
export const dictionaries = DICTS;
