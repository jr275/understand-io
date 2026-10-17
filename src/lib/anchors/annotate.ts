import type { Anchor, Annotation, HighlightColor } from "@/lib/content/types";
import type { Resolved } from "./index";

export const sameRange = (a: Anchor, b: Anchor) => a.start.b === b.start.b && a.start.o === b.start.o && a.end.b === b.end.b && a.end.o === b.end.o;

/** Highlights and underlines that cover exactly `anchor` (their resolved position, orphans excluded). */
export function marksOnRange(resolved: Resolved<Annotation>[], anchor: Anchor) {
  return resolved.filter((r) => r.anchor && r.item.kind !== "note" && sameRange(r.anchor, anchor)).map((r) => r.item);
}

export type AnnotateDecision =
  | { type: "add" }
  /** The range already has this kind of mark in another colour: change its colour instead of stacking a second one. */
  | { type: "recolor"; ids: string[] }
  /** The range already has exactly this mark: applying it again takes it off. */
  | { type: "remove"; ids: string[] };

/**
 * What creating a `kind` mark in `color` on `anchor` should do. Highlights and underlines never stack on an identical
 * range: the same kind and colour toggles the mark off, another colour recolours it. Notes always add (each note has its
 * own text).
 */
export function decideAnnotate(resolved: Resolved<Annotation>[], anchor: Anchor, kind: Annotation["kind"], color: HighlightColor): AnnotateDecision {
  if (kind === "note") return { type: "add" };
  const same = marksOnRange(resolved, anchor).filter((a) => a.kind === kind);
  if (!same.length) return { type: "add" };
  const other = same.filter((a) => (a.color ?? "yellow") !== color);
  // Several identical marks (stacked before this rule existed) are treated as one: they all go, or all take the new colour.
  return other.length ? { type: "recolor", ids: other.map((a) => a.id) } : { type: "remove", ids: same.map((a) => a.id) };
}
