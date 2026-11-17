import type { AiResult, Coverage, Gloss, GlossDocument, SummaryVariant } from "@/lib/content/types";
import { languageDisplay, tNow } from "@/i18n/runtime";
import type { MessageKey } from "@/i18n/translate";

export const STRUCTURED_ACTIONS = ["summarize", "translate", "concepts", "questions"] as const;

/** A gloss that is a structured result (summary, translation, ...) rather than a streamed answer in the margin. */
export const isInsight = (g: Pick<Gloss, "action">) => (STRUCTURED_ACTIONS as readonly string[]).includes(g.action);

/** The name of a summary variant, in the language the page is in. */
export const VARIANT_LABEL_KEY: Record<SummaryVariant, MessageKey> = { quick: "insights.quick", executive: "insights.executive", detailed: "insights.detailed", ideas: "insights.ideas", study: "insights.study", passage: "insights.passage" };

/** How a stored result relates to the text now on screen. */
export type VersionState = "current" | "earlier" | "unknown";

/**
 * `earlier` only when the result recorded which text it was written for and that text has changed since. A result without that record
 * (everything made before it existed) is `unknown`: it is shown as such, never claimed to be out of date.
 */
export function versionOf(g: Pick<Gloss, "result">, currentHash: string): VersionState {
  const r = g.result;
  if (!r || r.kind === "stream" || !r.docHash || !currentHash) return "unknown";
  return r.docHash === currentHash ? "current" : "earlier";
}

/** What a document-level result was made by, if it can be made again with the same button; null for passages, translations and streamed answers. */
export function regenerable(g: Pick<Gloss, "result">): { op: "summarize" | "concepts" | "questions"; variant?: SummaryVariant } | null {
  const r = g.result;
  if (!r || r.kind === "stream" || r.kind === "translation") return null;
  if (r.kind === "summary") return r.variant === "passage" ? null : { op: "summarize", variant: r.variant };
  return { op: r.kind };
}

/**
 * A finished result that already answers a request for a whole-text operation, so the model need not be called again: the same operation and
 * variant, written for exactly the text on screen and in the same output language, from the start of the text. Newest first in `insights`.
 */
export function findReusable(insights: Gloss[], want: { op: "summarize" | "concepts" | "questions"; variant?: SummaryVariant; outLang: string }, currentHash: string): Gloss | null {
  if (!currentHash) return null;
  for (const g of insights) {
    if (g.status !== "done") continue;
    const how = regenerable(g);
    const r = g.result;
    if (!how || !r || r.kind === "stream" || r.kind === "translation") continue;
    if (how.op !== want.op || how.variant !== want.variant) continue;
    if (r.docHash !== currentHash || (r.outLang ?? "") !== want.outLang) continue;
    if (r.coverage.from > 1) continue; // a continuation that began part-way is not the same operation
    return g;
  }
  return null;
}

export function insightTitle(r: AiResult): string {
  if (r.kind === "summary") return tNow(VARIANT_LABEL_KEY[r.variant]);
  if (r.kind === "concepts") return tNow("insights.titleConcepts");
  if (r.kind === "questions") return tNow("insights.titleQuestionsLong");
  return tNow("insights.titleTranslationTo", { language: languageDisplay(r.targetLang) });
}

/** The plain sentence that says which part of the text a result is based on (shown on every card and in exports). */
export function coverageLine(c: Coverage): string {
  if (c.complete) return tNow("insights.coverageWhole", { n: c.total });
  if (c.note && !c.used) return c.note;
  if (c.note) return c.note;
  return tNow("insights.coveragePart", { used: c.used, total: c.total });
}

/** Markdown for copying or downloading a result. Quotes stay marked as quotes, interpretation stays marked as interpretation. */
export function insightMarkdown(g: Gloss, doc: Pick<GlossDocument, "title" | "author" | "sourceUrl">): string {
  const r = g.result;
  if (!r || r.kind === "stream") return "";
  const lines: string[] = [`# ${insightTitle(r)}`, "", tNow("insights.mdText", { title: doc.title, author: doc.author ? `, ${doc.author}` : "", url: doc.sourceUrl ? ` (${doc.sourceUrl})` : "" }), tNow("insights.mdGenerated", { model: g.model ? ` (${g.model})` : "", date: new Date(g.createdAt).toISOString().slice(0, 10) }), ""];
  if (r.kind === "translation") {
    lines.push(`## ${tNow("insights.mdOriginal", { lang: r.sourceLang || tNow("insights.mdUnknownLang") })}`, "", ...r.original.split("\n").map((l) => `> ${l}`), "", `## ${tNow("insights.mdTranslation", { language: languageDisplay(r.targetLang) })}`, "", r.natural, "");
    if (r.literal) lines.push(`### ${tNow("insights.mdLiteral")}`, "", r.literal, "");
    if (r.notes.length) lines.push(`### ${tNow("insights.mdNotes")}`, "", ...r.notes.map((n) => `- ${n}`), "");
    return lines.join("\n");
  }
  lines.push(`_${coverageLine(r.coverage)}_`, "");
  for (const it of r.items) {
    const tag = it.basis === "interpretation" ? (it.unverified ? tNow("insights.mdInterpretationUnverified") : tNow("insights.mdInterpretation")) : it.basis === "external" ? tNow("insights.mdExternal") : "";
    lines.push(`- ${it.label ? `**${it.label}.** ` : ""}${it.text}${tag}`);
    if (it.answer) lines.push(`  - ${tNow("insights.mdAnswer", { answer: it.answer })}`);
    for (const e of it.evidence) lines.push(`  - ${e.n ? `¶${e.n}: ` : ""}“${e.quote}”`);
  }
  if (r.caveats.length) lines.push("", tNow("insights.mdLimits"), ...r.caveats.map((c) => `- ${c}`));
  return lines.join("\n") + "\n";
}
