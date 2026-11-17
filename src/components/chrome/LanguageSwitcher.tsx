"use client";

import { useI18n } from "@/i18n/client";
import { LOCALE_LIST, type Locale } from "@/i18n/config";
import type { MessageKey } from "@/i18n/translate";

const SHORT: Record<Locale, string> = { en: "EN", "pt-BR": "PT" };
const NAME: Record<Locale, MessageKey> = { en: "lang.en", "pt-BR": "lang.pt-BR" };

/**
 * Changes the language of the whole product. It does not reload the page and does not touch the reader's state: the document, the reading position
 * and any open conversation stay exactly where they are; the choice is remembered for the next visit. Each option is named in its own language
 * (`lang` attribute set), so a reader who does not read the current language can still find theirs.
 */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t("lang.label")} className={`inline-flex h-9 items-center rounded-full border border-rule p-0.5 text-[12px] font-medium ${className}`}>
      {LOCALE_LIST.map((l) => {
        const on = l === locale;
        return (
          <button
            key={l}
            type="button"
            lang={l}
            aria-pressed={on}
            aria-label={`${SHORT[l]} – ${t(NAME[l])}`}
            data-tip={t(NAME[l])}
            onClick={() => (on ? undefined : setLocale(l))}
            className={`h-8 min-w-8 rounded-full px-2 leading-none max-[360px]:min-w-7 max-[360px]:px-1.5 transition-colors ${on ? "bg-ink text-bg" : "text-ink-3 hover:bg-sunk hover:text-ink"}`}
          >
            {SHORT[l]}
          </button>
        );
      })}
    </div>
  );
}
