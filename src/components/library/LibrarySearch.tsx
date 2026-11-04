"use client";

import Link from "next/link";
import { Fragment, useEffect } from "react";
import { FileText, StickyNote } from "lucide-react";
import { track } from "@/lib/client/analytics";
import { bucketCount } from "@/lib/analytics/buckets";
import { highlightTerms, markHref, passageHref, type LibrarySearch as Result } from "@/lib/search/library";
import { useT } from "@/i18n/client";

function Marked({ text, matched, lang }: { text: string; matched: string[]; lang: string }) {
  return (
    <>
      {highlightTerms(text, matched, lang).map((r, i) => (
        <Fragment key={i}>{r.hit ? <mark className="libs-mark">{r.text}</mark> : r.text}</Fragment>
      ))}
    </>
  );
}

/** The answer to a library search: passages from the saved texts and the reader's own marks, each opening the text at that place. */
export function LibrarySearch({ query, result, titleMatches }: { query: string; result: Result; titleMatches: number }) {
  const t = useT();
  const { passages, marks, searched, unsearched, queryTokens } = result;
  const none = !passages.length && !marks.length;
  // Counts a search once the reader pauses typing: that a search happened and roughly how much it found, never what was typed.
  const found = passages.length + marks.length + titleMatches;
  useEffect(() => {
    const timer = setTimeout(() => track("library_searched", { scope: "library", results: bucketCount(found) }), 1200);
    return () => clearTimeout(timer);
  }, [query, found]);
  const texts = new Set(passages.map((p) => p.slug)).size;
  return (
    <section className="libs" aria-label={t("search.results")} data-testid="library-search">
      <p className="libs-summary" role="status">
        {none
          ? t("search.nothing", { texts: t("search.nTexts", { n: searched }), query: query.trim() })
          : t("search.found", { passages: t("search.nPassages", { n: passages.length }), texts: t("search.nTexts", { n: texts }), marks: marks.length ? t("search.ofYourMarks", { n: marks.length }) : "" })}
        {titleMatches ? ` ${t("search.titleMatches", { n: titleMatches })}` : ""}
        {unsearched ? ` ${t("search.unsearched", { n: unsearched })}` : ""}
      </p>

      {passages.length ? (
        <ol className="libs-list" aria-label={t("search.passages")}>
          {passages.map((p) => (
            <li key={`${p.slug}:${p.hit.blockId}:${p.hit.start}`}>
              <Link href={passageHref(p.slug, p.hit)} className="libs-item" data-libs-item="">
                <span className="libs-meta">
                  <FileText size={13} aria-hidden="true" />
                  <b>{p.title}</b>
                  {p.author ? <span> · {p.author}</span> : null}
                  {p.hit.n ? <span> · ¶{p.hit.n}</span> : null}
                  {p.confidence === "low" ? <span className="libs-part"> · {t("search.partial")}</span> : null}
                </span>
                <span className="libs-text">
                  <Marked text={p.hit.excerpt} matched={p.hit.matched} lang={p.lang} />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}

      {marks.length ? (
        <>
          <h2 className="libs-h">{t("search.yourMarks")}</h2>
          <ol className="libs-list" aria-label={t("search.marksLabel")}>
            {marks.map((m) => (
              <li key={m.annotation.id}>
                <Link href={markHref(m.slug, m.annotation.id)} className="libs-item" data-libs-item="">
                  <span className="libs-meta">
                    <StickyNote size={13} aria-hidden="true" />
                    <b>{m.title}</b>
                    <span> · {m.annotation.kind === "note" ? t("search.note") : m.annotation.kind === "underline" ? t("search.underline") : t("search.highlight")}</span>
                  </span>
                  <span className="libs-text">
                    {m.annotation.note ? <Marked text={m.annotation.note} matched={queryTokens} lang={m.lang} /> : null}
                    {m.annotation.note ? <br /> : null}
                    <span className="libs-quote">“<Marked text={m.annotation.anchor.quote} matched={queryTokens} lang={m.lang} />”</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
