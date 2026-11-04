"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLibrary } from "@/lib/store/library";
import { useT } from "@/i18n/client";

/** Bottom of the landing page: your latest highlights, or how it works when there are none. */
export function Desk() {
  const t = useT();
  const lib = useLibrary();
  const docsById = new Map(Object.values(lib.docs).map((d) => [d.id, d]));
  const highlights = Object.values(lib.annotations)
    .flat()
    .filter((a) => a.kind === "highlight" || a.kind === "underline")
    .sort((a, b) => b.createdAt - a.createdAt);

  if (highlights.length) {
    const shown = highlights.slice(0, 3);
    return (
      <section className="desk" aria-label={t("landing.latestHighlights")}>
        <header className="desk-head">
          <h2 className="desk-label">{t("landing.latestHighlights")}</h2>
          <div className="desk-aside">
            <Link href="/library" className="desk-link">
              {t("landing.all", { n: highlights.length })}
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </header>
        <ol className="desk-tiles">
          {shown.map((h, i) => {
            const doc = docsById.get(h.documentId);
            return (
              <li key={h.id} style={{ ["--i" as string]: i }}>
                <Link className="desk-tile is-quote" href={doc ? `/read/${doc.slug}?hl=${h.id}` : "/library"}>
                  <p className="line-clamp-3 font-serif text-[15.5px] leading-[1.5] text-ink [font-variation-settings:'opsz'_20]">
                    <span className={h.kind === "underline" ? "m-ul" : "m-hl"} data-c={h.color ?? "yellow"}>
                      {h.anchor.quote}
                    </span>
                  </p>
                  <p className="desk-source">
                    <span className="truncate">{doc?.title ?? t("landing.aText")}</span>
                    <ArrowRight size={13} aria-hidden="true" className="desk-source-go" />
                  </p>
                </Link>
              </li>
            );
          })}
          {shown.length < 3 ? (
            <li className="desk-tile is-room" style={{ ["--i" as string]: shown.length, gridColumn: shown.length === 1 ? "span 2" : undefined }}>
              {t("landing.roomHint")}
            </li>
          ) : null}
        </ol>
        <p className="desk-foot">{lib.persisted ? t("landing.keptBoth") : t("landing.keptLocal")}</p>
      </section>
    );
  }

  const steps = [
    [t("landing.step1"), t("landing.step1Text")],
    [t("landing.step2"), t("landing.step2Text")],
    [t("landing.step3"), t("landing.step3Text")],
  ];
  return (
    <section className="desk" aria-label={t("landing.howItWorks")}>
      <header className="desk-head">
        <h2 className="desk-label">{t("landing.howItWorks")}</h2>
      </header>
      <ol className="desk-tiles">
        {steps.map(([title, d], i) => (
          <li key={title} className="desk-tile is-step" style={{ ["--i" as string]: i }}>
            <span className="desk-step-n">{i + 1}</span>
            <p className="mt-3 text-[14.5px] font-medium text-ink">{title}</p>
            <p className="mt-1 text-[13.5px] leading-[1.42] text-ink-3">{d}</p>
          </li>
        ))}
      </ol>
      <p className="desk-foot">{lib.persisted ? t("landing.footBrowserServer") : t("landing.footBrowser")}</p>
    </section>
  );
}
