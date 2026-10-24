import { resolveAnchorDetailed } from "@/lib/anchors";
import type { Annotation, AnnotationKind, Block } from "@/lib/content/types";

export type MarkFilter = "all" | AnnotationKind;

/**
 * Where a mark's passage stands now. `unchecked` when this browser does not hold the text's words (a text kept only on the account), so
 * nothing can be said until it is opened; the review never claims a passage is found or lost without having looked.
 */
export type MarkStatus = "found" | "moved" | "missing" | "unchecked";

export interface ReviewDoc {
  id?: string;
  slug: string;
  title: string;
  /** The text's blocks when this browser has them. */
  blocks?: Block[];
}

export interface MarkRow {
  annotation: Annotation;
  status: MarkStatus;
}

export interface MarkGroup {
  id: string;
  slug: string;
  title: string;
  marks: MarkRow[];
}

const STATUS = { ok: "found", moved: "moved", orphaned: "missing" } as const;

/**
 * Every mark of every text on the shelf, grouped by text: texts with the newest mark first, marks newest first inside each. A mark whose text
 * is not on the shelf (hidden or deleted) is left out, as it has nowhere to open.
 */
export function reviewMarks(docs: ReviewDoc[], annotations: Record<string, Annotation[]>, filter: MarkFilter = "all"): MarkGroup[] {
  const groups: MarkGroup[] = [];
  for (const d of docs) {
    if (!d.id) continue;
    const marks = (annotations[d.id] ?? [])
      .filter((a) => filter === "all" || a.kind === filter)
      .map<MarkRow>((annotation) => ({
        annotation,
        status: d.blocks?.length ? STATUS[resolveAnchorDetailed(d.blocks, annotation.anchor).status] : "unchecked",
      }))
      .sort((a, b) => b.annotation.createdAt - a.annotation.createdAt);
    if (marks.length) groups.push({ id: d.id, slug: d.slug, title: d.title, marks });
  }
  return groups.sort((a, b) => b.marks[0].annotation.createdAt - a.marks[0].annotation.createdAt);
}

/** How many marks of each kind exist on the shelf (for the filter labels), whatever filter is applied. */
export function markCounts(docs: ReviewDoc[], annotations: Record<string, Annotation[]>): Record<MarkFilter, number> {
  const out: Record<MarkFilter, number> = { all: 0, highlight: 0, underline: 0, note: 0 };
  for (const g of reviewMarks(docs, annotations)) {
    for (const m of g.marks) {
      out.all += 1;
      out[m.annotation.kind] += 1;
    }
  }
  return out;
}

/** What a mark is called to the reader. Colour is never the only way to tell them apart. */
export function kindLabel(a: Pick<Annotation, "kind" | "color">): string {
  if (a.kind === "underline") return "Underline";
  if (a.kind === "note") return "Note";
  return a.color ? `Highlight (${a.color})` : "Highlight";
}
