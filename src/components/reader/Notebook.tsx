"use client";

import { useState } from "react";
import { Copy, Download, Trash2, X } from "lucide-react";
import type { Anchor, Annotation, Block, Gloss, GlossDocument } from "@/lib/content/types";
import type { Resolved } from "@/lib/anchors";
import { renderGlossBody } from "./glossMarkdown";
import { notebookMarkdown } from "./notebookMarkdown";

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
    <aside aria-label="Notebook" className="fixed bottom-2.5 left-2.5 right-2.5 top-[calc(var(--topbar-h)+6px)] z-[45] flex flex-col overflow-hidden rounded-[18px] border border-rule bg-raised shadow-pop sm:left-auto sm:w-[420px]" style={{ animation: "sheet-in 0.38s var(--ease-out)" }}>
      <header className="shrink-0 border-b border-transparent px-5 pb-3.5 pt-4">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[23px] font-[420] leading-none tracking-[-0.015em] text-ink [font-variation-settings:'opsz'_36]">Notebook</h2>
            <p className="mt-1.5 text-[12.5px] leading-none text-ink-3">
              {qCount} question{qCount === 1 ? "" : "s"}, {hCount} highlight{hCount === 1 ? "" : "s"}
              {lostCount ? <span className="text-rubric-text">, {lostCount} not found in the text</span> : null}
            </p>
          </div>
          <button type="button" aria-label="Copy as Markdown" data-tip="Copy as Markdown" disabled={!items.length} className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink disabled:pointer-events-none disabled:opacity-35" onClick={() => void navigator.clipboard?.writeText(markdown())}>
            <Copy size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Download Markdown"
            data-tip="Download Markdown"
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
          <button type="button" aria-label="Close notebook" data-tip="Close notebook" className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink" onClick={p.onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div role="tablist" aria-label="Show" className="mt-4 grid grid-cols-3 rounded-[10px] bg-sunk p-[3px]">
          {(
            [
              ["all", "All", qCount + hCount],
              ["questions", "Questions", qCount],
              ["highlights", "Highlights", hCount],
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
          <p className="px-2 pt-10 text-center text-[13.5px] leading-relaxed text-ink-3">Nothing here yet. Select a line in the text to ask about it, highlight it or leave a note.</p>
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
                        <span className="font-medium text-ink-2">{it.a.kind === "note" ? "Note" : it.a.kind === "underline" ? "Underline" : "Highlight"}</span>
                        <span className="text-ink-4">{ago(it.a.createdAt)}</span>
                        {it.orphaned ? <span className="rounded-full bg-sunk px-2 py-1 font-medium text-rubric-text">Couldn&rsquo;t find this passage</span> : null}
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
                    <button type="button" aria-label="Remove" data-tip="Remove" className={`absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full text-ink-4 transition-opacity hover:bg-sunk hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 ${it.orphaned ? "opacity-100" : "opacity-0"}`} onClick={() => p.onRemoveAnnotation(it.a.id)}>
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </article>
                </li>
              ),
            )}
          </ol>
        )}
        <p className="px-1 pb-1 pt-4 text-center text-[12.5px] leading-relaxed text-ink-3">{p.persisted ? "Kept in this browser and in your library on this server." : "These live in this browser only."}</p>
      </div>
    </aside>
  );
}

function GlossItem({ g, n, onOpen, onDelete, onCite, valid }: { g: Gloss; n?: number; onOpen: () => void; onDelete: () => void; onCite: (n: number) => void; valid: Set<number> | null }) {
  const [full, setFull] = useState(false);
  const q = g.turns.find((t) => t.role === "user")?.content ?? "What does this mean here?";
  const a = g.turns.filter((t) => t.role === "assistant").slice(-1)[0]?.content ?? "";
  const label = ({ explain: "Explain", simplify: "Simplify", ask: "Ask", define: "Define", factcheck: "Fact-check", related: "Related", counterpoint: "Counterpoint", overview: "Gloss", whole: "Whole text", summarize: "Summary", translate: "Translation", concepts: "Concepts", questions: "Questions" } as Record<string, string>)[g.action] ?? "Ask";
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
            <p className="font-serif text-[16.5px] leading-[1.35] text-ink [font-variation-settings:'opsz'_24]">{g.action === "ask" || g.action === "whole" ? q : ({ explain: "What does this mean here?", simplify: "Say it plainly.", define: "Define this.", factcheck: "Does this hold up?", related: "Where else is this taken up?", counterpoint: "What is the strongest objection?", overview: "What is the gist?" } as Record<string, string>)[g.action]}</p>
          </div>
          <div className="mt-2 grid grid-cols-[16px_minmax(0,1fr)] items-baseline gap-x-2">
            <span aria-hidden="true" className="text-[11.5px] font-semibold leading-none text-ink-4">A</span>
            <div className="min-w-0">
              <div className={`gloss-body !text-[14px] !leading-[1.55] text-ink-2 ${full ? "" : "nb-clamp is-over"}`}>{g.error ? <p className="text-rubric-text">{g.error}</p> : renderGlossBody(a, onCite, false, valid)}</div>
              {!full && a.length > 240 ? (
                <button type="button" className="mt-1.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink" onClick={() => setFull(true)}>
                  Read the whole answer
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <button type="button" aria-label="Delete this question" data-tip="Delete" className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full text-ink-4 opacity-0 transition-opacity hover:bg-sunk hover:text-ink focus-visible:opacity-100 group-hover:opacity-100" onClick={onDelete}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </article>
  );
}

export function ago(t: number) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}
