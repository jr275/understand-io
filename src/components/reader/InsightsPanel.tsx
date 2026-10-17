"use client";

import { useState } from "react";
import { AlignLeft, BookOpenCheck, Copy, Languages, ListChecks, Loader2, Trash2, X } from "lucide-react";
import type { AiItem, Evidence, Gloss, GlossDocument, SummaryVariant } from "@/lib/content/types";
import { LANGUAGES } from "@/lib/ai/languages";
import { coverageLine, insightMarkdown, insightTitle, VARIANT_LABEL } from "@/lib/ai/results";
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
  /** Summarize the part of the text after what this result read. */
  onContinue: (g: Gloss) => void;
  onJumpEvidence: (e: Evidence) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}

const SUMMARIES: { variant: SummaryVariant; hint: string }[] = [
  { variant: "quick", hint: "A few paragraphs: is this worth reading?" },
  { variant: "executive", hint: "Thesis, arguments, evidence, conclusions, implications" },
  { variant: "detailed", hint: "Section by section" },
  { variant: "ideas", hint: "The most important ideas, with their sources" },
];

export function InsightsPanel(p: InsightsProps) {
  if (!p.open) return null;
  const working = p.insights.some((g) => g.status === "streaming");
  return (
    <aside aria-label="Understand" className="fixed bottom-2.5 left-2.5 right-2.5 top-[calc(var(--topbar-h)+6px)] z-[45] flex flex-col overflow-hidden rounded-[18px] border border-rule bg-raised shadow-pop sm:left-auto sm:w-[440px]" style={{ animation: "sheet-in 0.38s var(--ease-out)" }}>
      <header className="shrink-0 px-5 pb-3 pt-4">
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
          <p className="px-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">Summarize this text</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {SUMMARIES.map((s) => (
              <button key={s.variant} type="button" disabled={working} data-tip={s.hint} className="flex items-center gap-2 rounded-[10px] bg-sunk px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-pill disabled:pointer-events-none disabled:opacity-50" onClick={() => p.onRun("summarize", s.variant)}>
                <AlignLeft size={14} aria-hidden="true" className="shrink-0 text-ink-3" />
                {VARIANT_LABEL[s.variant]}
              </button>
            ))}
          </div>
          <p className="mt-3 px-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">Check what you read</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button type="button" disabled={working} className="flex items-center gap-2 rounded-[10px] bg-sunk px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-pill disabled:pointer-events-none disabled:opacity-50" onClick={() => p.onRun("concepts")}>
              <BookOpenCheck size={14} aria-hidden="true" className="shrink-0 text-ink-3" />
              Key concepts
            </button>
            <button type="button" disabled={working} className="flex items-center gap-2 rounded-[10px] bg-sunk px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-pill disabled:pointer-events-none disabled:opacity-50" onClick={() => p.onRun("questions")}>
              <ListChecks size={14} aria-hidden="true" className="shrink-0 text-ink-3" />
              Test me
            </button>
          </div>
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
          {!p.hasKey ? (
            <p role="note" className="mt-2.5 rounded-[10px] bg-sunk px-3 py-2 text-[12.5px] leading-snug text-ink-2">
              These need a Together AI key. Add yours with the key button in the top bar; nothing is sent until you press one of these.
            </p>
          ) : (
            <p className="mt-2.5 px-1 text-[12px] leading-snug text-ink-3">Pressing one sends the text of this document to Together AI to be read. Nothing is sent otherwise.</p>
          )}
        </section>

        {p.insights.length === 0 ? (
          <p className="px-2 pt-8 text-center text-[13.5px] leading-relaxed text-ink-3">Nothing generated yet. Results are kept with this text, and every one says which part of it was read.</p>
        ) : (
          <ol className="mt-3 space-y-2.5" aria-label="Results">
            {p.insights.map((g) => (
              <li key={g.id}>
                <InsightCard g={g} doc={p.doc} onJump={p.onJumpEvidence} onDelete={() => p.onDelete(g.id)} onRetry={() => p.onRetry(g.id)} onCancel={() => p.onCancel(g.id)} onContinue={() => p.onContinue(g)} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
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

function InsightCard({ g, doc, onJump, onDelete, onRetry, onCancel, onContinue }: { g: Gloss; doc: GlossDocument; onJump: (e: Evidence) => void; onDelete: () => void; onRetry: () => void; onCancel: () => void; onContinue: () => void }) {
  const r = g.result && g.result.kind !== "stream" ? g.result : null;
  const title = r ? insightTitle(r) : g.action === "translate" ? "Translation" : g.action === "summarize" ? "Summary" : g.action === "concepts" ? "Key concepts" : "Questions";
  const [shown, setShown] = useState<Record<number, boolean>>({});
  return (
    <article className="group relative rounded-[14px] border border-rule bg-bg px-4 pb-3.5 pt-3.5" data-insight={g.id}>
      <div className="flex items-start gap-2 pr-16">
        <h3 className="font-serif text-[17px] font-[440] leading-tight text-ink">{title}</h3>
        <span className="mt-[3px] shrink-0 text-[11.5px] text-ink-4">{ago(g.createdAt)}</span>
      </div>
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

      {r && r.kind === "translation" ? (
        <div className="mt-3">
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-4">Original{r.sourceLang ? ` (${LANGUAGES[r.sourceLang.slice(0, 2)] ?? r.sourceLang})` : ""}</p>
              <p lang={r.sourceLang || undefined} className="mt-1 border-l-2 border-rule-strong pl-3 font-serif text-[14.5px] leading-[1.5] text-ink-2">
                {r.original}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-4">Translation ({LANGUAGES[r.targetLang] ?? r.targetLang})</p>
              <p lang={r.targetLang} className="mt-1 border-l-2 border-[var(--rubric-line)] pl-3 font-serif text-[14.5px] leading-[1.5] text-ink">
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
          <div className="mt-3 flex items-center gap-3 text-[12px] text-ink-3">
            <button type="button" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink" onClick={() => void navigator.clipboard?.writeText(r.natural)}>
              Copy translation
            </button>
            <span>{r.contextUsed ? "The surrounding paragraph was used to settle meaning." : "Translated without surrounding context."} The text in the reader is unchanged.</span>
          </div>
        </div>
      ) : null}

      {r && r.kind !== "translation" ? (
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

      {r ? <p className="mt-3 text-[11.5px] leading-snug text-ink-4">AI-generated{g.model ? ` by ${g.model.split("/").pop()}` : ""}. Quotes were checked against the text; “Interpretation” is the model&rsquo;s own reading, not the author&rsquo;s.</p> : null}
    </article>
  );
}
