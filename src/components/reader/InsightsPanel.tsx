"use client";

import { useEffect, useState } from "react";
import { AlignLeft, BookOpenCheck, ChevronDown, Copy, GraduationCap, Languages, ListChecks, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import type { AiItem, Evidence, Gloss, GlossDocument, SummaryVariant } from "@/lib/content/types";
import { LANGUAGES } from "@/lib/ai/languages";
import { coverageLine, insightMarkdown, insightTitle, regenerable, versionOf, type VersionState } from "@/lib/ai/results";
import { ago } from "./Notebook";
import { useI18n, useT } from "@/i18n/client";
import { tNow } from "@/i18n/runtime";
import type { MessageKey } from "@/i18n/translate";
import { localizeServerMessage as lm } from "@/i18n/serverMessages";

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
  /** Hash of the text now on screen (`lib/content/hash.ts`), to tell which results were written for it; "" until computed. */
  docHash: string;
  /** A result to bring into view and open (the Reader found it already answers what was asked); `n` makes asking twice work. */
  focusId: { id: string; n: number } | null;
  /** Make this result again from the whole text, even if one for this version of the text already exists. */
  onRegenerate: (g: Gloss) => void;
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
const TAB_LABEL: Record<Tab, MessageKey> = { all: "insights.tabAll", summary: "insights.tabSummary", learn: "insights.tabLearn", translation: "insights.tabTranslation" };

interface Action {
  id: string;
  label: MessageKey;
  hint: MessageKey;
  icon: typeof AlignLeft;
  run: (p: InsightsProps) => void;
}
/** What each button makes, in the words shown under it while nothing has been made yet. */
const ACTIONS: Action[] = [
  { id: "quick", label: "insights.quick", hint: "insights.quickHint", icon: AlignLeft, run: (p) => p.onRun("summarize", "quick") },
  { id: "executive", label: "insights.executive", hint: "insights.executiveHint", icon: AlignLeft, run: (p) => p.onRun("summarize", "executive") },
  { id: "detailed", label: "insights.detailed", hint: "insights.detailedHint", icon: AlignLeft, run: (p) => p.onRun("summarize", "detailed") },
  { id: "ideas", label: "insights.ideas", hint: "insights.ideasHint", icon: AlignLeft, run: (p) => p.onRun("summarize", "ideas") },
  { id: "study", label: "insights.study", hint: "insights.studyHint", icon: GraduationCap, run: (p) => p.onRun("summarize", "study") },
  { id: "concepts", label: "insights.concepts", hint: "insights.conceptsHint", icon: BookOpenCheck, run: (p) => p.onRun("concepts") },
  { id: "questions", label: "insights.questions", hint: "insights.questionsHint", icon: ListChecks, run: (p) => p.onRun("questions") },
  { id: "translate", label: "insights.translate", hint: "insights.translateHint", icon: Languages, run: (p) => p.onTranslatePart() },
];

export function InsightsPanel(p: InsightsProps) {
  const t = useT();
  const { locale } = useI18n();
  const langName = (code: string) => { try { return new Intl.DisplayNames(locale, { type: "language" }).of(code) ?? code; } catch { return code; } };
  const [tab, setTab] = useState<Tab>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tools, setTools] = useState(false);
  const focus = p.focusId;
  // A result the Reader points at opens when the pointer changes (set while rendering: the supported way to react to a changed prop).
  const [seenFocus, setSeenFocus] = useState(0);
  if (focus && focus.n !== seenFocus) {
    setSeenFocus(focus.n);
    setOpen((o) => ({ ...o, [focus.id]: true }));
  }
  useEffect(() => {
    if (!focus) return;
    // Once the card has opened, bring it into view.
    const timer = window.setTimeout(() => document.querySelector(`[data-insight="${focus.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
    return () => window.clearTimeout(timer);
  }, [focus]);
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
    <aside aria-label={t("insights.panel")} className="fixed bottom-2.5 left-2.5 right-2.5 top-[calc(var(--topbar-h)+6px)] z-[45] max-sm:top-[14vh] flex flex-col overflow-hidden rounded-[18px] border border-rule bg-raised shadow-pop sm:left-auto sm:w-[440px]" style={{ animation: "sheet-in 0.38s var(--ease-out)" }}>
      <span aria-hidden="true" className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-rule-strong sm:hidden" />
      <header className="shrink-0 px-5 pb-3 pt-4 max-sm:pt-2">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[23px] font-[420] leading-none tracking-[-0.015em] text-ink [font-variation-settings:'opsz'_36]">{t("insights.panel")}</h2>
            <p className="mt-1.5 text-[12.5px] leading-none text-ink-3">{t("insights.panelHelp")}</p>
          </div>
          <button type="button" aria-label={t("common.close")} data-tip={t("common.close")} className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink" onClick={p.onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto px-3.5 pb-4">
        <section aria-label={t("insights.makeSomething")} className="rounded-[14px] border border-rule bg-bg p-3">
          {!empty ? (
            <button type="button" aria-expanded={tools} className="flex w-full items-center justify-between rounded-[10px] px-1 py-0.5 text-left text-[13px] font-medium text-ink hover:text-ink" onClick={() => setTools((v) => !v)}>
              {t("insights.makeNew")}
              <ChevronDown size={15} aria-hidden="true" className={`text-ink-3 transition-transform ${tools ? "rotate-180" : ""}`} />
            </button>
          ) : null}
          {toolsShown ? (
            <div className={empty ? "" : "mt-2.5"}>
              {empty ? (
                <ul className="space-y-1.5" aria-label={t("insights.whatYouCanMake")}>
                  {ACTIONS.map((a) => (
                    <li key={a.id}>
                      <button type="button" disabled={working} className="flex w-full items-start gap-3 rounded-[10px] bg-sunk px-3 py-2.5 text-left transition-colors hover:bg-pill disabled:pointer-events-none disabled:opacity-50" onClick={() => a.run(p)}>
                        <a.icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-3" />
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-medium leading-tight text-ink">{t(a.label)}</span>
                          <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{t(a.hint)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {ACTIONS.map((a) => (
                    <button key={a.id} type="button" disabled={working} data-tip={t(a.hint)} className={`flex items-center gap-2 rounded-[10px] bg-sunk px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-pill disabled:pointer-events-none disabled:opacity-50 ${a.id === "translate" ? "col-span-2" : ""}`} onClick={() => a.run(p)}>
                      <a.icon size={14} aria-hidden="true" className="shrink-0 text-ink-3" />
                      {t(a.label)}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 px-1 text-[12.5px] text-ink-3">
                <label className="flex flex-col gap-1">
                  {t("insights.answerIn")}
                  <select value={p.outputLang} onChange={(e) => p.onOutputLang(e.target.value)} className="h-8 rounded-[8px] border border-rule bg-bg px-2 text-[13px] text-ink">
                    <option value="">{t("insights.interfaceLanguage")}</option>
                    {Object.entries(LANGUAGES).map(([c]) => (
                      <option key={c} value={c}>
                        {langName(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  {t("insights.translateTo")}
                  <select value={p.targetLang} onChange={(e) => p.onTargetLang(e.target.value)} className="h-8 rounded-[8px] border border-rule bg-bg px-2 text-[13px] text-ink">
                    {Object.entries(LANGUAGES).map(([c]) => (
                      <option key={c} value={c}>
                        {langName(c)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-3 flex items-start gap-1.5 px-1 text-[12px] leading-snug text-ink-3">
                <Languages size={13} aria-hidden="true" className="mt-px shrink-0" />
                <span>{t("insights.selectHint")}</span>
              </p>
            </div>
          ) : null}
          {!p.hasKey ? (
            <p role="note" className="mt-2.5 rounded-[10px] bg-sunk px-3 py-2 text-[12.5px] leading-snug text-ink-2">
              {t("insights.needKey")}
            </p>
          ) : toolsShown ? (
            <p className="mt-2.5 px-1 text-[12px] leading-snug text-ink-3">{t("insights.sendsText")}</p>
          ) : null}
        </section>

        {empty ? (
          <p className="px-2 pt-6 text-center text-[13px] leading-relaxed text-ink-3">{t("insights.kept")}</p>
        ) : (
          <>
            {p.insights.length > 2 ? (
              <div role="tablist" aria-label={t("insights.show")} className="sticky top-0 z-[1] -mx-0.5 mt-3 grid grid-cols-4 gap-0.5 rounded-[10px] bg-sunk p-[3px]">
                {(Object.keys(TAB_LABEL) as Tab[]).map((tb) => (
                  <button key={tb} type="button" role="tab" aria-selected={tab === tb} disabled={tb !== "all" && counts[tb] === 0} onClick={() => setTab(tb)} className={`flex h-7 items-center justify-center gap-1 rounded-[8px] px-1 text-[12px] font-medium transition-colors disabled:opacity-40 ${tab === tb ? "bg-pill text-ink shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-ink-3 hover:text-ink"}`}>
                    {t(TAB_LABEL[tb])}
                    <span className="tabular-nums text-ink-4">{counts[tb]}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <ol className="mt-3 space-y-2.5" aria-label={t("insights.results")}>
              {shown.map((g) => (
                <li key={g.id}>
                  <InsightCard g={g} doc={p.doc} version={versionOf(g, p.docHash)} onRegenerate={() => p.onRegenerate(g)} open={isOpen(g)} onToggle={() => setOpen((o) => ({ ...o, [g.id]: !isOpen(g) }))} onJump={p.onJumpEvidence} onDelete={() => p.onDelete(g.id)} onRetry={() => p.onRetry(g.id)} onCancel={() => p.onCancel(g.id)} onContinue={() => p.onContinue(g)} onTranslateNext={(n) => p.onTranslatePart(n)} />
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
  if (r.kind === "questions") return tNow("insights.previewQuestions", { n: r.items.length, first: r.items[0]?.text ?? "" });
  return r.items.map((i) => (i.label ? `${i.label}: ${i.text}` : i.text)).join(" ");
}

function Badge({ item }: { item: AiItem }) {
  const t = useT();
  if (item.basis === "text") return null;
  const label = item.basis === "external" ? t("insights.badgeExternal") : item.unverified ? t("insights.badgeNoQuote") : t("insights.badgeInterpretation");
  return <span className="ml-1.5 inline-block rounded-full bg-sunk px-2 py-[3px] align-[1px] text-[11px] font-medium leading-none text-ink-3">{label}</span>;
}

function Chip({ e, onJump }: { e: Evidence; onJump: (e: Evidence) => void }) {
  const t = useT();
  return (
    <button type="button" className="cite" aria-label={e.n ? t("insights.goToParagraph", { n: e.n, quote: e.quote.slice(0, 120) }) : t("insights.goToSource", { quote: e.quote.slice(0, 120) })} data-tip={`“${e.quote.length > 160 ? `${e.quote.slice(0, 157)}…` : e.quote}”`} onClick={() => onJump(e)}>
      {e.n ? `¶${e.n}` : "§"}
    </button>
  );
}

function InsightCard({ g, doc, version, onRegenerate, open, onToggle, onJump, onDelete, onRetry, onCancel, onContinue, onTranslateNext }: { g: Gloss; doc: GlossDocument; version: VersionState; onRegenerate: () => void; open: boolean; onToggle: () => void; onJump: (e: Evidence) => void; onDelete: () => void; onRetry: () => void; onCancel: () => void; onContinue: () => void; onTranslateNext: (after: number) => void }) {
  const { t, locale } = useI18n();
  const langName = (code: string) => {
    try {
      return new Intl.DisplayNames(locale, { type: "language" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const r = g.result && g.result.kind !== "stream" ? g.result : null;
  const title = r ? insightTitle(r) : g.action === "translate" ? t("insights.titleTranslation") : g.action === "summarize" ? t("insights.titleSummary") : g.action === "concepts" ? t("insights.titleConcepts") : t("insights.titleQuestions");
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
          <button type="button" aria-label={t("insights.copyMarkdown")} data-tip={t("insights.copyMarkdown")} className="grid size-7 place-items-center rounded-full text-ink-4 hover:bg-sunk hover:text-ink" onClick={() => void navigator.clipboard?.writeText(insightMarkdown(g, doc))}>
            <Copy size={13} aria-hidden="true" />
          </button>
        ) : null}
        {r && g.status === "done" && regenerable(g) ? (
          <button type="button" aria-label={t("insights.regenerate")} data-tip={t("insights.regenerateTip")} className="grid size-7 place-items-center rounded-full text-ink-4 hover:bg-sunk hover:text-ink" onClick={onRegenerate}>
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" aria-label={t("insights.deleteResult")} data-tip={t("insights.delete")} className="grid size-7 place-items-center rounded-full text-ink-4 hover:bg-sunk hover:text-ink" onClick={onDelete}>
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>

      {r && g.status === "done" && version === "earlier" ? (
        <p role="note" className="mt-3 rounded-[10px] bg-sunk px-3 py-2 text-[12.5px] leading-snug text-ink-2" data-version="earlier">
          {t("insights.earlier")}
          {regenerable(g) ? (
            <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={onRegenerate}>
              {t("insights.regenerate")}
            </button>
          ) : null}
        </p>
      ) : null}
      {r && g.status === "done" && version === "unknown" && open && r.kind !== "translation" ? (
        <p className="mt-2 text-[12px] leading-snug text-ink-4" data-version="unknown">
          {t("insights.unknownVersion")}
        </p>
      ) : null}

      {g.status === "streaming" ? (
        <div role="status" className="mt-3 flex items-center gap-2 text-[13px] text-ink-3">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          {t("insights.reading")}
          <button type="button" className="ml-auto text-[12.5px] font-medium text-ink-3 underline underline-offset-2 hover:text-ink" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      ) : null}
      {g.status === "error" ? (
        <div role="alert" className="mt-3 text-[13px] leading-snug text-rubric-text">
          {g.error ? lm(g.error) : t("reader.didNotWork")}
          <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={onRetry}>
            {t("glosses.tryAgain")}
          </button>
        </div>
      ) : null}

      {open && r && r.kind === "translation" ? (
        <div className="mt-3">
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-4">{t("insights.original")}{r.sourceLang ? ` (${langName(r.sourceLang.slice(0, 2))})` : ""}</p>
              <p lang={r.sourceLang || undefined} className="mt-1 whitespace-pre-line border-l-2 border-rule-strong pl-3 font-serif text-[14.5px] leading-[1.5] text-ink-2">
                {r.original}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-4">{t("insights.translation", { language: langName(r.targetLang) })}</p>
              <p lang={r.targetLang} className="mt-1 whitespace-pre-line border-l-2 border-[var(--rubric-line)] pl-3 font-serif text-[14.5px] leading-[1.5] text-ink">
                {r.natural}
              </p>
            </div>
          </div>
          {r.literal ? (
            <p className="mt-3 text-[13px] leading-snug text-ink-2">
              <span className="font-medium text-ink">{t("insights.literal")}</span>
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
              {t("insights.copyTranslation")}
            </button>
            {r.range ? (
              <p className="mt-1">
                {t("insights.paragraphsRange", { from: r.range.from, to: r.range.to })}{" "}
                <button type="button" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink" onClick={() => onTranslateNext(r.range!.to)}>
                  {t("insights.translateNext")}
                </button>
              </p>
            ) : null}
            <p className="mt-1">{r.contextUsed ? t("insights.withContext") : t("insights.noContext")} {t("insights.readerUnchanged")}</p>
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
                        {t("insights.showAnswer")}
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {r.caveats.length ? (
            <div className="mt-3 rounded-[10px] bg-sunk px-3 py-2 text-[12.5px] leading-snug text-ink-3">
              <p className="font-medium text-ink-2">{t("insights.limits")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {r.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {r.kind === "summary" && r.variant !== "passage" && !r.coverage.complete && r.coverage.to < r.coverage.total ? (
            <button type="button" className="mt-3 rounded-full bg-sunk px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-pill" onClick={onContinue}>
              {t("insights.summarizeRest", { n: r.coverage.to + 1 })}
            </button>
          ) : null}
        </div>
      ) : null}

      {open && r ? <p className="mt-3 text-[11.5px] leading-snug text-ink-4">{g.model ? t("insights.aiGeneratedBy", { model: g.model.split("/").pop() ?? "" }) : t("insights.aiGenerated")}{t("insights.aiFootnote")}</p> : null}
    </article>
  );
}
