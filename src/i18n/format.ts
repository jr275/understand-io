import type { Locale } from "./config";

/** Dates, numbers and money in the reader's language: always through `Intl`, never by hand, so separators, order and symbols follow the locale. */
const tag = (l: Locale) => (l === "pt-BR" ? "pt-BR" : "en-US");

export const formatNumber = (l: Locale, n: number, o?: Intl.NumberFormatOptions) => new Intl.NumberFormat(tag(l), o).format(n);
export const formatPercent = (l: Locale, ratio: number, digits = 0) => new Intl.NumberFormat(tag(l), { style: "percent", maximumFractionDigits: digits }).format(ratio);
export const formatCurrency = (l: Locale, amount: number, currency: string, o?: Intl.NumberFormatOptions) => new Intl.NumberFormat(tag(l), { style: "currency", currency, ...o }).format(amount);
export const formatDate = (l: Locale, d: Date | number | string, o: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) => new Intl.DateTimeFormat(tag(l), o).format(new Date(d));
export const formatDateTime = (l: Locale, d: Date | number | string) => formatDate(l, d, { dateStyle: "medium", timeStyle: "short" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31_536_000_000], ["month", 2_592_000_000], ["week", 604_800_000], ["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000]];
/** "3 days ago" / "há 3 dias": the largest unit that fits. */
export function formatRelative(l: Locale, then: Date | number | string, now: Date | number = Date.now()) {
  const diff = new Date(then).getTime() - new Date(now).getTime();
  const rtf = new Intl.RelativeTimeFormat(tag(l), { numeric: "auto" });
  for (const [unit, ms] of UNITS) if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  return rtf.format(0, "minute");
}
/** A list in the language's own grammar: "a, b, and c" / "a, b e c". */
export const formatList = (l: Locale, items: string[]) => new Intl.ListFormat(tag(l), { style: "long", type: "conjunction" }).format(items);
