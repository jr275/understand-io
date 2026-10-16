"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SAMPLE_META } from "@/lib/content/samples";
import { useLibrary } from "@/lib/store/library";
import { TopicGlyph } from "@/components/library/TopicGlyph";

/** Signed-out: sample chips. With reading in progress: "Continue <title> 87%" + "Your library →". */
export function SampleRow() {
  const lib = useLibrary();
  const inProgress = Object.values(lib.progress)
    .filter((p) => p.ratio > 0.02 && !p.finished)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const doc = inProgress ? Object.values(lib.docs).find((d) => d.id === inProgress.documentId) : null;

  if (inProgress && doc) {
    const pct = Math.round(inProgress.ratio * 100);
    const r = 5.5;
    const c = 2 * Math.PI * r;
    return (
      <p className="lib-line">
        <Link className="lib-line-note group transition-colors hover:text-ink" href={`/read/${doc.slug}`}>
          <svg viewBox="0 0 14 14" className="size-3.5 shrink-0 -rotate-90" aria-hidden="true">
            <circle cx="7" cy="7" r={r} fill="none" stroke="var(--rule-strong)" strokeWidth="1.8" />
            <circle cx="7" cy="7" r={r} fill="none" stroke="var(--rubric)" strokeWidth="1.8" strokeLinecap="round" strokeDasharray={`${(c * pct) / 100} ${c}`} />
          </svg>
          <span className="min-w-0 truncate">
            Continue <span className="text-ink">{doc.title}</span>
          </span>
          <span className="shrink-0 tabular-nums text-ink-4">{pct}%</span>
        </Link>
        <Link className="lib-line-go" href="/library">
          Your library <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </p>
    );
  }

  return (
    <p className="lib-line">
      <span>No link handy? Try</span>
      {SAMPLE_META.map((s) => (
        <Link key={s.slug} className="lib-sample" data-tip={s.tip} data-tip-hint={s.hint} href={`/read/${s.slug}`}>
          <TopicGlyph topic={s.slug === "on-a-piece-of-chalk" ? "science" : s.slug === "walden-reading" ? "learning" : "philosophy"} size={22} className="sample-dot" />
          {s.short}
        </Link>
      ))}
    </p>
  );
}
