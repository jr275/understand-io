import type { Annotation, Block, Gloss } from "@/lib/content/types";
import type { Resolved } from "@/lib/anchors";
import { plainAnswer } from "./glossMarkdown";
import { tNow } from "@/i18n/runtime";
import type { MessageKey } from "@/i18n/translate";

export interface NotebookExportInput {
  doc: { title: string; author?: string | null; sourceUrl?: string | null };
  blocks: Block[];
  annotations: Resolved<Annotation>[];
  glosses: Resolved<Gloss>[];
}

const KIND_LABEL: Record<Annotation["kind"], MessageKey> = { highlight: "marks.kindHighlight", underline: "marks.kindUnderline", note: "marks.kindNote" };
const GLOSS_LABEL: Record<string, MessageKey> = { explain: "lens.explain", simplify: "lens.simplify", ask: "lens.ask", define: "lens.define", factcheck: "lens.factcheck", related: "lens.related", counterpoint: "lens.counterpoint", overview: "glosses.overview", whole: "glosses.whole" };
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Neutralise Markdown block syntax at the start of a line, so a note that begins with "# x" or "- y" stays text. */
function plain(line: string) {
  return line.replace(/^(\s*)([#>*+-]|\d+[.)]|```|~~~|\|)/, "$1\\$2");
}
const block = (text: string, prefix: string) =>
  text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => `${prefix}${plain(l)}`.trimEnd());
/** A labelled paragraph: the label opens the first line (so it cannot be mistaken for block syntax), later lines are neutralised. */
const labelled = (label: string, text: string) => {
  const [head, ...rest] = text.replace(/\r/g, "").split("\n");
  return [`${label} ${head}`.trimEnd(), ...rest.map((l) => plain(l).trimEnd())];
};
const quoteLines = (text: string, prefix = "") =>
  text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => `${prefix}> ${l}`.trimEnd());

/**
 * The notebook as Markdown: every annotation and question in document order (not creation order), with its paragraph
 * number, colour and date. Multi-line quotes and notes keep their line breaks inside their list item, and anything whose
 * passage could not be found again is exported with its stored quote and labelled as such.
 */
export function notebookMarkdown({ doc, blocks, annotations, glosses }: NotebookExportInput): string {
  const idx = new Map(blocks.map((b, i) => [b.id, i]));
  const nOf = (r: { anchor: { start: { b: string } } | null }) => (r.anchor ? blocks[idx.get(r.anchor.start.b) ?? -1]?.n : undefined);
  const order = (r: { anchor: { start: { b: string; o: number } } | null; item: { createdAt: number } }) => [r.anchor ? (idx.get(r.anchor.start.b) ?? 0) : -1, r.anchor?.start.o ?? 0, r.item.createdAt];
  const byDocument = <T extends { anchor: { start: { b: string; o: number } } | null; item: { createdAt: number } }>(list: T[]) =>
    [...list].sort((x, y) => {
      const a = order(x);
      const b = order(y);
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    });

  const lines: string[] = [`# ${doc.title.replace(/\n/g, " ")}`];
  if (doc.author) lines.push(`*${doc.author.replace(/\n/g, " ")}*`);
  if (doc.sourceUrl) lines.push(tNow("notebookMd.source", { url: doc.sourceUrl }));
  lines.push("");

  for (const g of byDocument(glosses)) {
    const orphan = g.status === "orphaned";
    const n = nOf(g);
    lines.push(`## ${GLOSS_LABEL[g.item.action] ? tNow(GLOSS_LABEL[g.item.action]) : g.item.action}${n ? ` (¶${n})` : ""}${orphan ? tNow("notebookMd.notFoundSuffix") : ""}, ${day(g.item.createdAt)}`);
    if (g.item.anchor) lines.push(...quoteLines(g.item.anchor.quote), "");
    for (const t of g.item.turns) lines.push(...labelled(`**${t.role === "user" ? tNow("notebookMd.q") : tNow("notebookMd.a")}:**`, plainAnswer(t.content)), "");
  }

  const live = byDocument(annotations.filter((r) => r.status !== "orphaned"));
  const lost = byDocument(annotations.filter((r) => r.status === "orphaned"));
  const item = (r: Resolved<Annotation>, orphan: boolean) => {
    const a = r.item;
    const n = nOf(r);
    const meta = [n ? `¶${n}` : "", a.kind === "underline" ? "" : (a.color ?? "yellow"), day(a.createdAt)].filter(Boolean).join(", ");
    lines.push(`- **${tNow(KIND_LABEL[a.kind])}** (${meta})${orphan ? tNow("notebookMd.notFoundSuffix") : ""}`);
    lines.push(...quoteLines(a.anchor.quote, "  "));
    if (a.note) lines.push("", ...block(a.note, "  "));
    lines.push("");
  };
  if (live.length) {
    lines.push(`## ${tNow("notebookMd.highlightsAndNotes")}`, "");
    live.forEach((r) => item(r, false));
  }
  if (lost.length) {
    lines.push(`## ${tNow("notebookMd.lost")}`, "");
    lost.forEach((r) => item(r, true));
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
