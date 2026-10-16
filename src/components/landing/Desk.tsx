"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLibrary } from "@/lib/store/library";

/** Bottom of the landing page: your latest highlights, or how it works when there are none. */
export function Desk() {
  const lib = useLibrary();
  const docsById = new Map(Object.values(lib.docs).map((d) => [d.id, d]));
  const highlights = Object.values(lib.annotations)
    .flat()
    .filter((a) => a.kind === "highlight" || a.kind === "underline")
    .sort((a, b) => b.createdAt - a.createdAt);

  if (highlights.length) {
    const shown = highlights.slice(0, 3);
    return (
      <section className="desk" aria-label="Your latest highlights">
        <header className="desk-head">
          <h2 className="desk-label">Your latest highlights</h2>
          <div className="desk-aside">
            <Link href="/library" className="desk-link">
              All {highlights.length}
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
                    <span className="truncate">{doc?.title ?? "A text"}</span>
                    <ArrowRight size={13} aria-hidden="true" className="desk-source-go" />
                  </p>
                </Link>
              </li>
            );
          })}
          {shown.length < 3 ? (
            <li className="desk-tile is-room" style={{ ["--i" as string]: shown.length, gridColumn: shown.length === 1 ? "span 2" : undefined }}>
              Select a line in anything you read, and it waits for you here.
            </li>
          ) : null}
        </ol>
        <p className="desk-foot">{lib.persisted ? "Kept in this browser and in your library on this server." : "These live in this browser only."}</p>
      </section>
    );
  }

  const steps = [
    ["Paste a link", "An article, a chapter or a PDF."],
    ["Select any line", "A word, a sentence, a passage."],
    ["Ask it anything", "The answer lands in the margin, citing the text."],
  ];
  return (
    <section className="desk" aria-label="How it works">
      <header className="desk-head">
        <h2 className="desk-label">How it works</h2>
      </header>
      <ol className="desk-tiles">
        {steps.map(([t, d], i) => (
          <li key={t} className="desk-tile is-step" style={{ ["--i" as string]: i }}>
            <span className="desk-step-n">{i + 1}</span>
            <p className="mt-3 text-[14.5px] font-medium text-ink">{t}</p>
            <p className="mt-1 text-[13.5px] leading-[1.42] text-ink-3">{d}</p>
          </li>
        ))}
      </ol>
      <p className="desk-foot">Highlights, notes and answers are kept in this browser{lib.persisted ? " and on this server" : ""}.</p>
    </section>
  );
}
