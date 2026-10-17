"use client";

import { useState } from "react";
import { AlignLeft, BookOpenCheck, ChevronDown, Copy, Languages, ListChecks, Loader2, Trash2, X } from "lucide-react";
import type { AiItem, Evidence, Gloss, GlossDocument, SummaryVariant } from "@/lib/content/types";
import { LANGUAGES } from "@/lib/ai/languages";
import { coverageLine, insightMarkdown, insightTitle } from "@/lib/ai/results";
import { ago } from "./Notebook";

export interface InsightsProps {
  open: boolean;
  onClose: () => void;
  doc: GlossDocument;
  /** Structured results for this document, newest first. */
  insights: Gloss[];
  hasKey: boolean;
  /** Language of summaries, concepts and questions; "" = the text's own language. */
  outputLang: string;
  onOutputLang: (code: string) => void;
  targetLang: string;
  onTargetLang: (code: string) => void;
  onRun: (op: "summarize" | "concepts" | "questions", variant?: SummaryVariant) => void;
  /** Translate a part of the text that starts at the paragraph on screen, or after the part a translation already covers. */
  onTranslatePart: (afterParagraph?: number) => void;
  /** Summarize the part of the text after what this result read. */
  onContinue: (g: Gloss) => void;
  onJumpEvidence: (e: Evidence) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}

type Tab = "all" | "summary" | "learn" | "translation";
const tabOf = (g: Gloss): Exclude<Tab, "all"> => (g.action === "translate" ? "translation" : g.action === "summarize" ? "summary" : "learn");
const TAB_LABEL: Record<Tab, string> = { all: "All", summary: "Summaries", learn: "Learn", translation: "Translations" };

interface Action {
  id: string;
  label: string;
  hint: string;
  icon: typeof AlignLeft;
  run: (p: InsightsProps) => void;
}
/** What each button makes, in the words shown under it while nothing has been made yet. */
const ACTIONS: Action[] = [
  { id: "quick", label: "Quick summary", hint: "A few paragraphs: is this worth reading?", icon: AlignLeft, run: (p) => p.onRun("summarize", "quick") },
  { id: "executive", label: "Executive summary", hint: "Thesis, arguments, evidence, conclusions, implications", icon: AlignLeft, run: (p) => p.onRun("summarize", "executive") },
  { id: "detailed", label: "Detailed summary", hint: "Section by section, with concepts and reservations", icon: AlignLeft, run: (p) => p.onRun("summarize", "detailed") },
  { id: "ideas", label: "Key ideas", hint: "The most important ideas, each with its source", icon: AlignLeft, run: (p) => p.onRun("summarize", "ideas") },
  { id: "concepts", label: "Key concepts", hint: "Terms you need, explained as this text uses them", icon: BookOpenCheck, run: (p) => p.onRun("concepts") },
  { id: "questions", label: "Test me", hint: "Questions that check your understanding; answers stay hidden", icon: ListChecks, run: (p) => p.onRun("questions") },
  { id: "translate", label: "Translate from the paragraph on screen", hint: "A page at a time, with the original beside it", icon: Languages, run: (p) => p.onTranslatePart() },
];

export function InsightsPanel(p: InsightsProps) {
  const [tab, setTab] = useState<Tab>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tools, setTools] = useState(false);
  if (!p.open) return null;
  const working = p.insights.some((g) => g.status === "streaming");
  const empty = p.insights.length === 0;
  const counts: Record<Tab, number> = { all: p.insights.length, summary: 0, learn: 0, translation: 0 };
  for (const g of p.insights) counts[tabOf(g)]++;
  const shown = p.insights.filter((g) => tab === "all" || tabOf(g) === tab);
  const newest = p.insights[0]?.id;
  // The newest result, and anything still running or failed, starts open; the reader's own choice wins afterwards.
  const isOpen = (g: Gloss) => open[g.id] ?? (g.id === newest || g.status !== "done");
  const toolsShown = empty || tools;
  return (
    <aside aria-label="Understand" className="fixed bottom-2.5 left-2.5 right-2.5 top-[calc(var(--topbar-h)+6px)] z-[45] max-sm:top-[14vh] flex flex-col overflow-hidden rounded-[18px] border border-rule bg-raised shadow-pop sm:left-auto sm:w-[440px]" style={{ animation: "sheet-in 0.38s var(--ease-out)" }}>
      <span aria-hidden="true" className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-rule-strong sm:hidden" />
      <header className="shrink-0 px-5 pb-3 pt-4 max-sm:pt-2">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[23px] font-[420] leading-none tracking-[-0.015em] text-ink [font-variation-settings:'opsz'_36]">Understand</h2>
            <p className="mt-1.5 text-[12.5px] leading-none text-ink-3">Summaries, concepts, questions and translations</p>
          </div>
          <button type="button" aria-label="Close" data-tip="Close" className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink" onClick={p.onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto px-3.5 pb-4">
        <section aria-label="Make something" className="rounded-[14px] border border-rule bg-bg p-3">
          {!empty ? (
            <button type="button" aria-expanded={tools} className="flex w-full items-center justify-between rounded-[10px] px-1 py-0.5 text-left text-[13px] font-medium text-ink hover:text-ink" onClick={() => setTools((t) => !t)}>
              Make something new
              <ChevronDown size={15} aria-hidden="true" className={`text-ink-3 transition-transform ${tools ? "rotate-180" : ""}`} />
            </button>
          ) : null}
          {toolsShown ? (
            <div className={empty ? "" : "mt-2.5"}>
              {empty ? (
                <ul className="space-y-1.5" aria-label="What you can make">
                  {ACTIONS.map((a) => (
                    <li key={a.id}>
                      <button type="button" disabled={working} className="flex w-full items-start gap-3 rounded-[10px] bg-sunk px-3 py-2.5 text-left transition-colors hover:bg-pill disabled:pointer-events-none disabled:opacity-50" onClick={() => a.run(p)}>
                        <a.icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-3" />
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-medium leading-tight text-ink">{a.label}</span>
                          <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{a.hint}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {ACTIONS.map((a) => (
                    <button key={a.id} type="button" disabled={working} data-tip={a.hint} className={`flex items-center gap-2 rounded-[10px] bg-sunk px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-pill disabled:pointer-events-none disabled:opacity-50 ${a.id === "translate" ? "col-span-2" : ""}`} onClick={() => a.run(p)}>
                      <a.icon size={14} aria-hidden="true" className="shrink-0 text-ink-3" />
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 px-1 text-[12.5px] text-ink-3">
                <label className="flex flex-col gap-1">
                  Answer in
                  <select value={p.outputLang} onChange={(e) => p.onOutputLang(e.target.value)} className="h-8 rounded-[8px] border border-rule bg-bg px-2 text-[13px] text-ink">
                    <option value="">Language of the text</option>
                    {Object.entries(LANGUAGES).map(([c, n]) => (
                      <option key={c} value={c}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Translate to
                  <select value={p.targetLang} onChange={(e) => p.onTargetLang(e.target.value)} className="h-8 rounded-[8px] border border-rule bg-bg px-2 text-[13px] text-ink">
                    {Object.entries(LANGUAGES).map(([c, n]) => (
                      <option key={c} value={c}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-3 flex items-start gap-1.5 px-1 text-[12px] leading-snug text-ink-3">
                <Languages size={13} aria-hidden="true" className="mt-px shrink-0" />
                <span>To translate or summarize one passage, select it in the text and use the toolbar.</span>
              </p>
            </div>
          ) : null}
          {!p.hasKey ? (
            <p role="note" className="mt-2.5 rounded-[10px] bg-sunk px-3 py-2 text-[12.5px] leading-snug text-ink-2">
              These need a Together AI key. Add yours with the key button in the top bar; nothing is sent until you press one of these.
            </p>
          ) : toolsShown ? (
            <p className="mt-2.5 px-1 text-[12px] leading-snug text-ink-3">Pressing one sends the text of this document to Together AI to be read. Nothing is sent otherwise.</p>
          ) : null}
        </section>

        {empty ? (
          <p className="px-2 pt-6 text-center text-[13px] leading-relaxed text-ink-3">Results are kept with this text, and every one says which part of it was read.</p>
        ) : (
          <>
            {p.insights.length > 2 ? (
              <div role="tablist" aria-label="Show" className="sticky top-0 z-[1] -mx-0.5 mt-3 grid grid-cols-4 gap-0.5 rounded-[10px] bg-sunk p-[3px]">
                {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} disabled={t !== "all" && counts[t] === 0} onClick={() => setTab(t)} className={`flex h-7 items-center justify-center gap-1 rounded-[8px] px-1 text-[12px] font-medium transition-colors disabled:opacity-40 ${tab === t ? "bg-pill text-ink shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-ink-3 hover:text-ink"}`}>
                    {TAB_LABEL[t]}
                    <span className="tabular-nums text-ink-4">{counts[t]}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <ol className="mt-3 space-y-2.5" aria-label="Results">
              {shown.map((g) => (
                <li key={g.id}>
                  <InsightCard g={g} doc={p.doc} open={isOpen(g)} onToggle={() => setOpen((o) => ({ ...o, [g.id]: !isOpen(g) }))} onJump={p.onJumpEvidence} onDelete={() => p.onDelete(g.id)} onRetry={() => p.onRetry(g.id)} onCancel={() => p.onCancel(g.id)} onContinue={() => p.onContinue(g)} onTranslateNext={(n) => p.onTranslatePart(n)} />
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </aside>
  );
}

/** One or two lines that say what a collapsed result holds. */
function previewOf(r: NonNullable<Gloss["result"]> & { kind: Exclude<NonNullable<Gloss["result"]>["kind"], "stream"> }): string {
  if (r.kind === "translation") return r.natural;
  if (r.kind === "concepts") return r.items.map((i) => i.label).filter(Boolean).join(", ") || r.items[0]?.text || "";
  if (r.kind === "questions") return `${r.items.length} question${r.items.length === 1 ? "" : "s"}: ${r.items[0]?.text ?? ""}`;
  return r.items.map((i) => (i.label ? `${i.label}: ${i.text}` : i.text)).join(" ");
}

function Badge({ item }: { item: AiItem }) {
  if (item.basis === "text") return null;
  const label = item.basis === "external" ? "From outside the text" : item.unverified ? "Interpretation · no quote found" : "Interpretation";
  return <span className="ml-1.5 inline-block rounded-full bg-sunk px-2 py-[3px] align-[1px] text-[11px] font-medium leading-none text-ink-3">{label}</span>;
}

function Chip({ e, onJump }: { e: Evidence; onJump: (e: Evidence) => void }) {
  return (
    <button type="button" className="cite" aria-label={`Go to ${e.n ? `paragraph ${e.n}` : "the source"}: ${e.quote.slice(0, 120)}`} data-tip={`“${e.quote.length > 160 ? `${e.quote.slice(0, 157)}…` : e.quote}”`} onClick={() => onJump(e)}>
      {e.n ? `¶${e.n}` : "§"}
    </button>
  );
}

function InsightCard({ g, doc, open, onToggle, onJump, onDelete, onRetry, onCancel, onContinue, onTranslateNext }: { g: Gloss; doc: GlossDocument; open: boolean; onToggle: () => void; onJump: (e: Evidence) => void; onDelete: () => void; onRetry: () => void; onCancel: () => void; onContinue: () => void; onTranslateNext: (after: number) => void }) {
  const r = g.result && g.result.kind !== "stream" ? g.result : null;
  const title = r ? insightTitle(r) : g.action === "translate" ? "Translation" : g.action === "summarize" ? "Summary" : g.action === "concepts" ? "Key concepts" : "Questions";
  const [shown, setShown] = useState<Record<number, boolean>>({});
  return (
    <article className="group relative rounded-[14px] border border-rule bg-bg px-4 pb-3.5 pt-3.5" data-insight={g.id}>
      <button type="button" aria-expanded={open} className="flex w-full items-start gap-2 pr-16 text-left" onClick={onToggle}>
        <ChevronDown size={15} aria-hidden="true" className={`mt-[3px] shrink-0 text-ink-3 transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <h3 className="font-serif text-[17px] font-[440] leading-tight text-ink">{title}</h3>
            <span className="shrink-0 text-[11.5px] text-ink-4">{ago(g.createdAt)}</span>
          </span>
          {!open && r ? <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-ink-3">{previewOf(r)}</span> : null}
        </span>
      </button>
      <div className="absolute right-2 top-2 flex">
        {r ? (
          <button type="button" aria-label="Copy as Markdown" data-tip="Copy as Markdown" className="grid size-7 place-items-center rounded-full text-ink-4 hover:bg-sunk hover:text-ink" onClick={() => void navigator.clipboard?.writeText(insightMarkdown(g, doc))}>
            <Copy size={13} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" aria-label="Delete this result" data-tip="Delete" className="grid size-7 place-items-center rounded-full text-ink-4 hover:bg-sunk hover:text-ink" onClick={onDelete}>
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>

      {g.status === "streaming" ? (
        <div role="status" className="mt-3 flex items-center gap-2 text-[13px] text-ink-3">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          Reading the text…
          <button type="button" className="ml-auto text-[12.5px] font-medium text-ink-3 underline underline-offset-2 hover:text-ink" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : null}
      {g.status === "error" ? (
        <div role="alert" className="mt-3 text-[13px] leading-snug text-rubric-text">
          {g.error ?? "That did not work."}
          <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}

      {open && r && r.kind === "translation" ? (
        <div className="mt-3">
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-4">Original{r.sourceLang ? ` (${LANGUAGES[r.sourceLang.slice(0, 2)] ?? r.sourceLang})` : ""}</p>
              <p lang={r.sourceLang || undefined} className="mt-1 whitespace-pre-line border-l-2 border-rule-strong pl-3 font-serif text-[14.5px] leading-[1.5] text-ink-2">
                {r.original}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-4">Translation ({LANGUAGES[r.targetLang] ?? r.targetLang})</p>
              <p lang={r.targetLang} className="mt-1 whitespace-pre-line border-l-2 border-[var(--rubric-line)] pl-3 font-serif text-[14.5px] leading-[1.5] text-ink">
                {r.natural}
              </p>
            </div>
          </div>
          {r.literal ? (
            <p className="mt-3 text-[13px] leading-snug text-ink-2">
              <span className="font-medium text-ink">Literal: </span>
              <span lang={r.targetLang}>{r.literal}</span>
            </p>
          ) : null}
          {r.notes.length ? (
            <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[13px] leading-snug text-ink-2">
              {r.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 text-[12px] leading-snug text-ink-3">
            <button type="button" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink" onClick={() => void navigator.clipboard?.writeText(r.natural)}>
              Copy translation
            </button>
            {r.range ? (
              <p className="mt-1">
                Paragraphs {r.range.from} to {r.range.to}.{" "}
                <button type="button" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink" onClick={() => onTranslateNext(r.range!.to)}>
                  Translate the next part
                </button>
              </p>
            ) : null}
            <p className="mt-1">{r.contextUsed ? "The surrounding paragraph was used to settle meaning." : "Translated without surrounding context."} The text in the reader is unchanged.</p>
          </div>
        </div>
      ) : null}

      {open && r && r.kind !== "translation" ? (
        <div className="mt-2.5">
          <p className="text-[12px] leading-snug text-ink-3">{coverageLine(r.coverage)}</p>
          <ul className="mt-3 space-y-3">
            {r.items.map((it, i) => (
              <li key={i} className="text-[14px] leading-[1.55] text-ink-2">
                {it.label ? <span className="font-medium text-ink">{it.label}. </span> : null}
                {it.text}
                <Badge item={it} />
                {it.evidence.map((e, k) => (
                  <Chip key={k} e={e} onJump={onJump} />
                ))}
                {r.kind === "questions" && it.answer ? (
                  <div className="mt-1.5">
                    {shown[i] ? (
                      <p className="rounded-[10px] bg-sunk px-3 py-2 text-[13.5px] text-ink-2">{it.answer}</p>
                    ) : (
                      <button type="button" className="text-[12.5px] font-medium text-ink-3 underline underline-offset-2 hover:text-ink" onClick={() => setShown((s) => ({ ...s, [i]: true }))}>
                        Show the answer
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {r.caveats.length ? (
            <div className="mt-3 rounded-[10px] bg-sunk px-3 py-2 text-[12.5px] leading-snug text-ink-3">
              <p className="font-medium text-ink-2">Limits</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {r.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {r.kind === "summary" && r.variant !== "passage" && !r.coverage.complete && r.coverage.to < r.coverage.total ? (
            <button type="button" className="mt-3 rounded-full bg-sunk px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-pill" onClick={onContinue}>
              Summarize the rest (from ¶{r.coverage.to + 1})
            </button>
          ) : null}
        </div>
      ) : null}

      {open && r ? <p className="mt-3 text-[11.5px] leading-snug text-ink-4">AI-generated{g.model ? ` by ${g.model.split("/").pop()}` : ""}. Quotes were checked against the text; “Interpretation” is the model&rsquo;s own reading, not the author&rsquo;s.</p> : null}
    </article>
  );
}
