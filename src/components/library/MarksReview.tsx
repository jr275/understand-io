"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Highlighter, NotebookPen, Trash2, Underline } from "lucide-react";
import { markHref } from "@/lib/search/library";
import { removeAnnotation } from "@/lib/store/library";
import { markCounts, reviewMarks, type MarkFilter, type MarkStatus, type ReviewDoc } from "@/lib/store/marksReview";
import type { Annotation } from "@/lib/content/types";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";

const FILTERS: { id: MarkFilter; label: MessageKey }[] = [
  { id: "all", label: "marks.all" },
  { id: "highlight", label: "marks.highlights" },
  { id: "underline", label: "marks.underlines" },
  { id: "note", label: "marks.notes" },
];

const STATUS_NOTE: Partial<Record<MarkStatus, MessageKey>> = {
  missing: "marks.missing",
  moved: "marks.moved",
};

const KIND: Record<Annotation["kind"], MessageKey> = { highlight: "marks.kindHighlight", underline: "marks.kindUnderline", note: "marks.kindNote" };

const COLOUR: Record<string, MessageKey> = { yellow: "appearance.markYellow", green: "appearance.markGreen", blue: "appearance.markBlue", pink: "appearance.markPink" };

/** What a mark is called: a highlight also names its colour, so colour is never the only way to tell marks apart. */
function kindText(t: (k: MessageKey, v?: Record<string, string | number>) => string, a: Annotation): string {
  const colour = a.kind === "highlight" && a.color ? COLOUR[a.color] : undefined;
  return colour ? t("marks.kindHighlightColour", { colour: t(colour).toLowerCase() }) : t(KIND[a.kind]);
}

/** Most texts listed before "Show all": a long shelf stays a quick glance. */
const FIRST = 6;

function Icon({ kind }: { kind: Annotation["kind"] }) {
  if (kind === "underline") return <Underline size={14} aria-hidden="true" />;
  if (kind === "note") return <NotebookPen size={14} aria-hidden="true" />;
  return <Highlighter size={14} aria-hidden="true" />;
}

/**
 * Every highlight, underline and note on the shelf in one place: grouped by text, filtered by kind, each opening the text at its passage or
 * removable. It reads the same store as the Reader, so a mark made or removed in either shows in both.
 */
export function MarksReview({ docs, annotations }: { docs: ReviewDoc[]; annotations: Record<string, Annotation[]> }) {
  const t = useT();
  const [filter, setFilter] = useState<MarkFilter>("all");
  const [all, setAll] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const counts = useMemo(() => markCounts(docs, annotations), [docs, annotations]);
  const groups = useMemo(() => reviewMarks(docs, annotations, filter), [docs, annotations, filter]);
  if (!counts.all) return null;
  const shown = all ? groups : groups.slice(0, FIRST);
  return (
    <section className="marks-review mt-10" aria-labelledby="marks-heading" data-marks-review="">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id="marks-heading" className="lib-label">
          {t("marks.heading")} <span className="tabular-nums text-ink-4">{counts.all}</span>
        </h2>
        <div role="radiogroup" aria-label={t("marks.show")} className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filter === f.id}
              disabled={f.id !== "all" && counts[f.id] === 0}
              className="rounded-full border border-rule px-3 py-1 text-[12.5px] text-ink-2 hover:bg-sunk disabled:opacity-40 aria-checked:border-ink aria-checked:text-ink"
              onClick={() => setFilter(f.id)}
            >
              {t(f.label)} <span className="tabular-nums text-ink-4">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {!groups.length ? <p className="mt-3 text-[13px] text-ink-3">{t("marks.none")}</p> : null}
      <ul className="mt-3 space-y-5">
        {shown.map((g) => (
          <li key={g.id} data-marks-doc={g.slug}>
            <h3 className="font-serif text-[16px] leading-tight text-ink">
              <Link href={`/read/${encodeURIComponent(g.slug)}`} className="hover:underline">
                {g.title}
              </Link>{" "}
              <span className="text-[12px] text-ink-4">
                {t("marks.nMarks", { n: g.marks.length })}
              </span>
            </h3>
            <ul className="mt-2 space-y-2">
              {g.marks.map(({ annotation: a, status }) => (
                <li key={a.id} className="rounded-[12px] border border-rule bg-bg px-3.5 py-3" data-mark-kind={a.kind} data-mark-status={status}>
                  <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                    <Icon kind={a.kind} /> {kindText(t, a)}
                  </p>
                  <blockquote className="mt-1.5 border-l-2 border-rule-strong pl-3 font-serif text-[14.5px] leading-[1.5] text-ink-2">
                    {a.anchor.quote.length > 280 ? `${a.anchor.quote.slice(0, 277)}…` : a.anchor.quote}
                  </blockquote>
                  {a.note ? <p className="mt-1.5 text-[13px] leading-snug text-ink">{a.note}</p> : null}
                  {STATUS_NOTE[status] ? <p className="mt-1.5 text-[12px] leading-snug text-ink-3">{t(STATUS_NOTE[status]!)}</p> : null}
                  <div className="mt-2 flex items-center gap-4 text-[12.5px]">
                    <Link href={markHref(g.slug, a.id)} className="font-medium text-ink underline decoration-rule-strong underline-offset-4">
                      {t("marks.openAt")}
                    </Link>
                    {confirm === a.id ? (
                      <span className="flex items-center gap-3" role="group" aria-label={t("marks.confirm")}>
                        <button
                          type="button"
                          className="font-medium text-rubric-text underline underline-offset-4"
                          onClick={() => {
                            removeAnnotation(g.id, a.id);
                            setConfirm(null);
                          }}
                        >
                          {t("marks.removeMark")}
                        </button>
                        <button type="button" className="text-ink-3 underline underline-offset-4" onClick={() => setConfirm(null)}>
                          {t("marks.keep")}
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="inline-flex items-center gap-1 text-ink-3 hover:text-ink" onClick={() => setConfirm(a.id)} aria-label={t("marks.removeThis", { kind: t(KIND[a.kind]).toLowerCase() })}>
                        <Trash2 size={13} aria-hidden="true" /> {t("marks.remove")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {groups.length > FIRST ? (
        <button type="button" className="mt-4 text-[13px] font-medium text-ink underline underline-offset-4" onClick={() => setAll((v) => !v)}>
          {all ? t("marks.showFewer") : t("marks.showAll", { n: groups.length })}
        </button>
      ) : null}
      <p className="mt-4 text-[12px] leading-snug text-ink-4">{t("marks.footnote")}</p>
    </section>
  );
}
