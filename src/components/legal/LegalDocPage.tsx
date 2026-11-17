import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/chrome/Topbar";
import { LEGAL_DOCS, LEGAL_LANGS, legalFlagOn, resolveLegal, type LegalDoc, type LegalLang } from "@/lib/legal/docs";
import { Markdown } from "@/lib/legal/markdown";
import { localePath } from "@/i18n/config";
import { getT } from "@/i18n/server";

const LANG_NAME: Record<LegalLang, string> = { en: "English", pt: "Português" };

/** One legal text, in one language. A draft, or a text the operator has not switched on, is a 404: see `lib/legal/docs.ts`. */
export async function LegalDocPage({ doc, lang }: { doc: LegalDoc; lang: LegalLang }) {
  const t = await getT();
  const r = resolveLegal(doc, lang);
  if (!r.ok) {
    // Switched on but not final: the operator should hear about it, the reader just sees a page that does not exist.
    if (r.reason !== "off" && legalFlagOn()) console.warn(`[legal] ${doc} is not shown: ${r.reason === "open-items" ? "it still has open items (⚠️)" : "a language version is missing"}`);
    notFound();
  }
  const others = (Object.keys(LEGAL_DOCS) as LegalDoc[]).filter((d) => d !== doc && resolveLegal(d, "en").ok);
  const here = LEGAL_DOCS[doc];
  return (
    <div className="relative z-[1] flex min-h-dvh flex-col">
      <Topbar variant="landing" />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-6 pb-24 pt-8 sm:px-8">
        <nav aria-label={t("legal.language")} className="mb-6 flex gap-3 text-[13px] text-ink-3">
          {LEGAL_LANGS.map((l) =>
            l === lang ? (
              <span key={l} aria-current="true" className="font-medium text-ink">
                {LANG_NAME[l]}
              </span>
            ) : (
              // a plain link: the two languages are one route to the router, so only a real page load shows the other text
              <a key={l} href={localePath(here.route, l === "pt" ? "pt-BR" : "en")} className="underline underline-offset-2" hrefLang={l === "pt" ? "pt-BR" : "en"}>
                {LANG_NAME[l]}
              </a>
            ),
          )}
        </nav>
        <article lang={lang === "pt" ? "pt-BR" : "en"}>
          <Markdown source={r.markdown} />
        </article>
        {others.length ? (
          <nav aria-label={t("legal.others")} className="mt-14 border-t border-rule pt-5 text-[13.5px] text-ink-3">
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              {others.map((d) => (
                <li key={d}>
                  <Link href={localePath(LEGAL_DOCS[d].route, lang === "pt" ? "pt-BR" : "en")} className="underline underline-offset-2">
                    {LEGAL_DOCS[d].title[lang]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </main>
    </div>
  );
}
