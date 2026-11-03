"use client";

import { useState } from "react";
import { Copy, Download, Trash2, X } from "lucide-react";
import type { Anchor, Annotation, Block, Gloss, GlossDocument } from "@/lib/content/types";
import type { Resolved } from "@/lib/anchors";
import { renderGlossBody } from "./glossMarkdown";
import { notebookMarkdown } from "./notebookMarkdown";
import { tNow } from "@/i18n/runtime";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";

interface Props {
  open: boolean;
  onClose: () => void;
  doc: GlossDocument;
  blocks: Block[];
  /** Annotations and glosses with the place their passage has now (null anchor + `orphaned` status when it could not be found). */
  annotations: Resolved<Annotation>[];
  glosses: Resolved<Gloss>[];
  onJump: (a: Anchor) => void;
  onOpenGloss: (id: string) => void;
  onRemoveAnnotation: (id: string) => void;
  onDeleteGloss: (id: string) => void;
  onCite: (n: number) => void;
  citeSet?: (g: Gloss) => Set<number> | null;
  persisted: boolean | null;
}

type Tab = "all" | "questions" | "highlights";

export function Notebook(p: Props) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("all");
  if (!p.open) return null;
  // Paragraph numbers come from where the passage is now, not from the stored (possibly stale) anchor.
  const nOf = (a: Anchor | null) => (a ? p.blocks.find((b) => b.id === a.start.b)?.n : undefined);
  const items = [
    ...p.glosses.filter((r) => r.item.status !== "streaming").map((r) => ({ kind: "gloss" as const, at: r.item.createdAt, g: r.item, anchor: r.anchor })),
    ...p.annotations.map((r) => ({ kind: "ann" as const, at: r.item.createdAt, a: r.item, anchor: r.anchor, orphaned: r.status === "orphaned" })),
  ]
    .filter((i) => (tab === "all" ? true : tab === "questions" ? i.kind === "gloss" : i.kind === "ann"))
    .sort((x, y) => y.at - x.at);
  const qCount = p.glosses.filter((r) => r.item.status !== "streaming").length;
  const hCount = p.annotations.length;
  const lostCount = p.annotations.filter((r) => r.status === "orphaned").length;

  const markdown = () => notebookMarkdown({ doc: p.doc, blocks: p.blocks, annotations: p.annotations, glosses: p.glosses.filter((r) => r.item.status !== "streaming") });

  return (
    <aside aria-label={t("notebook.panel")} className="fixed bottom-2.5 left-2.5 right-2.5 top-[calc(var(--topbar-h)+6px)] z-[45] max-sm:top-[14vh] flex flex-col overflow-hidden rounded-[18px] border border-rule bg-raised shadow-pop sm:left-auto sm:w-[420px]" style={{ animation: "sheet-in 0.38s var(--ease-out)" }}>
      <header className="shrink-0 border-b border-transparent px-5 pb-3.5 pt-4">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[23px] font-[420] leading-none tracking-[-0.015em] text-ink [font-variation-settings:'opsz'_36]">{t("notebook.panel")}</h2>
            <p className="mt-1.5 text-[12.5px] leading-none text-ink-3">
              {t("notebook.summary", { questions: t("notebook.nQuestions", { n: qCount }), highlights: t("notebook.nHighlights", { n: hCount }) })}
              {lostCount ? <span className="text-rubric-text">{t("notebook.lost", { n: lostCount })}</span> : null}
            </p>
          </div>
          <button type="button" aria-label={t("notebook.copyMd")} data-tip={t("notebook.copyMd")} disabled={!items.length} className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink disabled:pointer-events-none disabled:opacity-35" onClick={() => void navigator.clipboard?.writeText(markdown())}>
            <Copy size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("notebook.downloadMd")}
            data-tip={t("notebook.downloadMd")}
            disabled={!items.length}
            className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink disabled:pointer-events-none disabled:opacity-35"
            onClick={() => {
              const blob = new Blob([markdown()], { type: "text/markdown" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `${p.doc.slug}.md`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            <Download size={16} aria-hidden="true" />
          </button>
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-rule" />
          <button type="button" aria-label={t("notebook.close")} data-tip={t("notebook.close")} className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink" onClick={p.onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div role="tablist" aria-label={t("notebook.show")} className="mt-4 grid grid-cols-3 rounded-[10px] bg-sunk p-[3px]">
          {(
            [
              ["all", t("notebook.tabAll"), qCount + hCount],
              ["questions", t("notebook.tabQuestions"), qCount],
              ["highlights", t("notebook.tabHighlights"), hCount],
            ] as const
          ).map(([id, label, count]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex h-7 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] font-medium transition-colors ${tab === id ? "bg-pill text-ink shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-ink-3 hover:text-ink"}`}>
              {label}
              <span className="tabular-nums text-ink-4">{count}</span>
            </button>
          ))}
        </div>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto px-3.5 pb-4 pt-0.5">
        {items.length === 0 ? (
          <p className="px-2 pt-10 text-center text-[13.5px] leading-relaxed text-ink-3">{t("notebook.empty")}</p>
        ) : (
          <ol className="space-y-2.5">
            {items.map((it, i) =>
              it.kind === "gloss" ? (
                <li key={it.g.id} className="rise" style={{ animationDuration: ".45s", animationDelay: `${i * 35}ms` }}>
                  <GlossItem g={it.g} n={nOf(it.anchor)} onOpen={() => p.onOpenGloss(it.g.id)} onDelete={() => p.onDeleteGloss(it.g.id)} onCite={p.onCite} valid={p.citeSet?.(it.g) ?? null} />
                </li>
              ) : (
                <li key={it.a.id} className="rise" style={{ animationDuration: ".45s", animationDelay: `${i * 35}ms` }}>
                  <article className="group relative rounded-[14px] border border-rule bg-bg px-4 pb-3.5 pt-3.5 transition-colors hover:border-rule-strong" data-orphan={it.orphaned ? it.a.id : undefined}>
                    <button type="button" className="block w-full pr-7 text-left" disabled={it.orphaned} onClick={() => it.anchor && p.onJump(it.anchor)}>
                      <span className="flex items-center gap-2 text-[11.5px] leading-none text-ink-3">
                        {nOf(it.anchor) ? <span className="cite pointer-events-none !m-0 !text-[11px]">¶{nOf(it.anchor)}</span> : null}
                        <span className="font-medium text-ink-2">{it.a.kind === "note" ? t("marks.kindNote") : it.a.kind === "underline" ? t("marks.kindUnderline") : t("marks.kindHighlight")}</span>
                        <span className="text-ink-4">{ago(it.a.createdAt)}</span>
                        {it.orphaned ? <span className="rounded-full bg-sunk px-2 py-1 font-medium text-rubric-text">{t("notebook.notFound")}</span> : null}
                      </span>
                      <span className="mt-2.5 block font-serif text-[15.5px] leading-[1.5] text-ink">
                        {it.orphaned ? (
                          <span className="text-ink-3">{it.a.anchor.quote}</span>
                        ) : (
                          <mark className={`${it.a.kind === "underline" ? "m-ul" : it.a.kind === "note" ? "m-note" : "m-hl"} text-inherit`} data-c={it.a.color ?? "yellow"}>
                            {it.a.anchor.quote}
                          </mark>
                        )}
                      </span>
                      {it.a.note ? <span className="mt-2 block text-[13.5px] leading-[1.5] text-ink-2">{it.a.note}</span> : null}
                    </button>
                    <button type="button" aria-label={t("notebook.remove")} data-tip={t("notebook.remove")} className={`absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full text-ink-4 transition-opacity hover:bg-sunk hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 ${it.orphaned ? "opacity-100" : "opacity-0"}`} onClick={() => p.onRemoveAnnotation(it.a.id)}>
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </article>
                </li>
              ),
            )}
          </ol>
        )}
        <p className="px-1 pb-1 pt-4 text-center text-[12.5px] leading-relaxed text-ink-3">{p.persisted ? t("landing.keptBoth") : t("landing.keptLocal")}</p>
      </div>
    </aside>
  );
}

function GlossItem({ g, n, onOpen, onDelete, onCite, valid }: { g: Gloss; n?: number; onOpen: () => void; onDelete: () => void; onCite: (n: number) => void; valid: Set<number> | null }) {
  const t = useT();
  const [full, setFull] = useState(false);
  const q = g.turns.find((t) => t.role === "user")?.content ?? t("notebook.defaultQuestion");
  const a = g.turns.filter((t) => t.role === "assistant").slice(-1)[0]?.content ?? "";
  const label = t(({ explain: "lens.explain", simplify: "lens.simplify", ask: "lens.ask", define: "lens.define", factcheck: "lens.factcheck", related: "lens.related", counterpoint: "lens.counterpoint", overview: "glosses.overview", whole: "glosses.whole", summarize: "notebook.labelSummary", translate: "notebook.labelTranslation", concepts: "notebook.labelConcepts", questions: "notebook.labelQuestions" } as Record<string, MessageKey>)[g.action] ?? "lens.ask");
  return (
    <article className="group relative rounded-[14px] border border-rule bg-bg px-4 pb-4 pt-3.5 transition-colors hover:border-rule-strong">
      <button type="button" className="block w-full pr-7 text-left" onClick={onOpen}>
        <span className="flex items-center gap-2 text-[11.5px] leading-none text-ink-3">
          {n ? <span className="cite pointer-events-none !m-0 !text-[11px]">¶{n}</span> : null}
          <span className="font-medium text-ink-2">{label}</span>
          <span className="text-ink-4">{ago(g.createdAt)}</span>
        </span>
        {g.anchor ? <span className="mt-2.5 line-clamp-2 border-l-2 border-[var(--rubric-line)] pl-3 font-serif text-[15px] leading-[1.45] text-ink-3 transition-colors group-hover:text-ink-2">{g.anchor.quote}</span> : null}
      </button>
      <div className="mt-3.5 space-y-4">
        <div>
          <div className="grid grid-cols-[16px_minmax(0,1fr)] items-baseline gap-x-2">
            <span aria-hidden="true" className="text-[11.5px] font-semibold leading-none text-rubric-text">Q</span>
            <p className="font-serif text-[16.5px] leading-[1.35] text-ink [font-variation-settings:'opsz'_24]">{g.action === "ask" || g.action === "whole" ? q : t(({ explain: "notebook.qExplain", simplify: "notebook.qSimplify", define: "notebook.qDefine", factcheck: "notebook.qFactcheck", related: "notebook.qRelated", counterpoint: "notebook.qCounterpoint", overview: "notebook.qOverview" } as Record<string, MessageKey>)[g.action] ?? "notebook.defaultQuestion")}</p>
          </div>
          <div className="mt-2 grid grid-cols-[16px_minmax(0,1fr)] items-baseline gap-x-2">
            <span aria-hidden="true" className="text-[11.5px] font-semibold leading-none text-ink-4">A</span>
            <div className="min-w-0">
              <div className={`gloss-body !text-[14px] !leading-[1.55] text-ink-2 ${full ? "" : "nb-clamp is-over"}`}>{g.error ? <p className="text-rubric-text">{g.error}</p> : renderGlossBody(a, onCite, false, valid)}</div>
              {!full && a.length > 240 ? (
                <button type="button" className="mt-1.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink" onClick={() => setFull(true)}>
                  {t("notebook.readWhole")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <button type="button" aria-label={t("notebook.deleteQuestion")} data-tip={t("notebook.delete")} className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full text-ink-4 opacity-0 transition-opacity hover:bg-sunk hover:text-ink focus-visible:opacity-100 group-hover:opacity-100" onClick={onDelete}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </article>
  );
}

export function ago(t: number) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return tNow("time.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return tNow("time.minAgo", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return tNow("time.hAgo", { n: h });
  const d = Math.round(h / 24);
  return tNow("time.dAgo", { n: d });
}
