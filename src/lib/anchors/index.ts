import type { Anchor, AnchorPoint, Block } from "@/lib/content/types";
import { NOTE_MAX_LENGTH } from "@/lib/content/types";

const CONTEXT = 32;
/** Characters kept from the neighbouring blocks (tail of the block before, head of the block after). */
const NEIGHBOUR = 24;

/** Cut a note to the stored limit without leaving half of a surrogate pair at the end (the server refuses lone surrogates). */
export function clampNote(s: string, max = NOTE_MAX_LENGTH): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** Order blocks by position so anchors can span several blocks. */
export function blockIndex(blocks: Block[]) {
  const map = new Map<string, number>();
  blocks.forEach((b, i) => map.set(b.id, i));
  return map;
}

export function comparePoints(a: AnchorPoint, b: AnchorPoint, idx: Map<string, number>) {
  const ai = idx.get(a.b) ?? -1;
  const bi = idx.get(b.b) ?? -1;
  if (ai !== bi) return ai - bi;
  return a.o - b.o;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Build an anchor from block ids and offsets, filling in the quote and context. Throws for a block id that is not in `blocks`. */
export function makeAnchor(blocks: Block[], start: AnchorPoint, end: AnchorPoint, idx: Map<string, number> = blockIndex(blocks)): Anchor {
  if (!idx.has(start.b) || !idx.has(end.b)) throw new RangeError(`unknown block id: ${idx.has(start.b) ? end.b : start.b}`);
  let s = start;
  let e = end;
  if (comparePoints(s, e, idx) > 0) [s, e] = [e, s];
  const parts: string[] = [];
  const si = idx.get(s.b)!;
  const ei = idx.get(e.b)!;
  for (let i = si; i <= ei; i++) {
    const t = blocks[i].text;
    const from = i === si ? s.o : 0;
    const to = i === ei ? e.o : t.length;
    parts.push(t.slice(from, to));
  }
  const quote = parts.join("\n");
  const prefix = blocks[si].text.slice(Math.max(0, s.o - CONTEXT), s.o);
  const suffix = blocks[ei].text.slice(e.o, e.o + CONTEXT);
  const prevBlock = si > 0 ? blocks[si - 1].text.slice(-NEIGHBOUR) : "";
  const nextBlock = ei < blocks.length - 1 ? blocks[ei + 1].text.slice(0, NEIGHBOUR) : "";
  return { start: s, end: e, quote, prefix, suffix, prevBlock, nextBlock };
}

/* ------------------------------------------------------------------ graphemes and folding */

let segmenter: Intl.Segmenter | null | undefined;
function graphemeSegmenter() {
  if (segmenter === undefined) segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  return segmenter;
}

/** Grapheme clusters of `s` as [start, end) UTF-16 ranges (code points when Intl.Segmenter is missing). */
function clusters(s: string): { start: number; end: number }[] {
  const seg = graphemeSegmenter();
  const out: { start: number; end: number }[] = [];
  if (seg) {
    for (const g of seg.segment(s)) out.push({ start: g.index, end: g.index + g.segment.length });
    return out;
  }
  for (let i = 0; i < s.length; ) {
    const n = (s.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
    out.push({ start: i, end: i + n });
    i += n;
  }
  return out;
}

/**
 * Move offset `o` out of the middle of a grapheme cluster (an emoji with a skin tone, a letter with a combining accent):
 * a selection start moves back to the cluster's start, an end forward to its end. Never leaves half a surrogate pair.
 */
export function snapToGrapheme(text: string, o: number, side: "start" | "end"): number {
  if (o <= 0) return 0;
  if (o >= text.length) return text.length;
  // Clusters are short: look at a window around the point (starting on a code point boundary).
  let from = Math.max(0, o - 64);
  if (from > 0 && (text.charCodeAt(from) & 0xfc00) === 0xdc00) from--;
  const window = text.slice(from, Math.min(text.length, o + 64));
  for (const c of clusters(window)) {
    if (from + c.start >= o) break;
    if (o < from + c.end) return side === "start" ? from + c.start : from + c.end;
  }
  return o;
}

/** Text folded for comparison: NFC, typographic quotes and dashes, non-breaking spaces. Applied per grapheme cluster so offsets can be mapped back. */
const FOLD: Record<string, string> = { "‘": "'", "’": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "–": "-", "—": "-", " ": " ", " ": " ", " ": " " };
const fold = (s: string) => s.normalize("NFC").replace(/[‘’‛“”„–—   ]/g, (c) => FOLD[c]);

interface Folded {
  text: string;
  /** For every UTF-16 unit of the folded text: where its source cluster starts and ends in the original text. */
  from: number[];
  to: number[];
}
const foldedCache = new WeakMap<Block[], (Folded | undefined)[]>();
function foldedBlock(blocks: Block[], i: number): Folded {
  let per = foldedCache.get(blocks);
  if (!per) foldedCache.set(blocks, (per = []));
  const hit = per[i];
  if (hit) return hit;
  const text = blocks[i].text;
  const f: Folded = { text: "", from: [], to: [] };
  for (const c of clusters(text)) {
    const part = fold(text.slice(c.start, c.end));
    for (let k = 0; k < part.length; k++) {
      f.from.push(c.start);
      f.to.push(c.end);
    }
    f.text += part;
  }
  return (per[i] = f);
}

/* ------------------------------------------------------------------ re-anchoring */

export type AnchorStatus = "ok" | "moved" | "orphaned";

/** Length of the longest common suffix / prefix of two strings. */
function commonSuffix(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefix(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
/** Agreement shorter than this many characters (or than the whole expectation, when that is shorter) is coincidence, not evidence. */
const MIN_AGREEMENT = 4;
const agreement = (common: number, expected: string) => (common < Math.min(MIN_AGREEMENT, expected.length) ? 0 : common / expected.length);
/** How much of `expected` (text that should end right where `actual` ends) is present: 0..1. An empty expectation means "nothing there". */
function tailMatch(expected: string, actual: string) {
  if (!expected) return actual ? 0 : 1;
  return agreement(commonSuffix(expected, actual), expected);
}
/** Same for text that should start where `actual` starts. */
function headMatch(expected: string, actual: string) {
  if (!expected) return actual ? 0 : 1;
  return agreement(commonPrefix(expected, actual), expected);
}

interface Place {
  /** Block index and offset of the first character, block index and offset after the last. */
  si: number;
  so: number;
  ei: number;
  eo: number;
}

/** How well the surroundings of `p` agree with the anchor's stored context, per field in 0..1 (`undefined` = the anchor has no such field). */
function contextFractions(blocks: Block[], a: Anchor, p: Place) {
  const before = (n: number) => blocks[p.si].text.slice(Math.max(0, p.so - n), p.so);
  const after = (n: number) => blocks[p.ei].text.slice(p.eo, p.eo + n);
  return {
    // An empty prefix/suffix means the quote touched the start/end of its block.
    prefix: a.prefix === undefined ? undefined : a.prefix === "" ? (p.so === 0 ? 1 : 0) : tailMatch(a.prefix, before(a.prefix.length)),
    suffix: a.suffix === undefined ? undefined : a.suffix === "" ? (p.eo === blocks[p.ei].text.length ? 1 : 0) : headMatch(a.suffix, after(a.suffix.length)),
    prevBlock: a.prevBlock === undefined ? undefined : tailMatch(a.prevBlock, p.si > 0 ? blocks[p.si - 1].text.slice(-a.prevBlock.length || undefined) : ""),
    nextBlock: a.nextBlock === undefined ? undefined : headMatch(a.nextBlock, p.ei < blocks.length - 1 ? blocks[p.ei + 1].text.slice(0, a.nextBlock.length || undefined) : ""),
  };
}

/** Evidence from the context in 0..10 (prefix and suffix weigh 3 each, the neighbouring blocks 2 each). */
function contextScore(f: ReturnType<typeof contextFractions>) {
  return 3 * (f.prefix ?? 0) + 3 * (f.suffix ?? 0) + 2 * (f.prevBlock ?? 0) + 2 * (f.nextBlock ?? 0);
}

/** The text of a place, joined the way anchors quote it. */
function quoteAt(blocks: Block[], p: Place) {
  if (p.si === p.ei) return blocks[p.si].text.slice(p.so, p.eo);
  const parts = [blocks[p.si].text.slice(p.so)];
  for (let i = p.si + 1; i < p.ei; i++) parts.push(blocks[i].text);
  parts.push(blocks[p.ei].text.slice(0, p.eo));
  return parts.join("\n");
}

/** A short quote with no supporting context is not enough to claim a passage; a quote this long is distinctive on its own. */
const DISTINCTIVE = 12;
/** The best candidate has to beat the runner-up by this much, or the anchor is ambiguous and counts as orphaned. */
const MARGIN = 1;
/** Context evidence needed to accept a candidate on its own: an exact prefix or suffix, or both neighbouring blocks. */
const CONFIDENCE = 3;

interface Candidate {
  place: Place;
  /** Evidence from the surroundings, 0..10. */
  ctx: number;
  /** Evidence from the position: same block and closeness to the stored offset, 0..2. */
  pos: number;
  exactStored: boolean;
  /** Extra evidence specific to multi-block quotes (untouched middle blocks), 0..2. */
  body: number;
}

function pick(cands: Candidate[], quoteLength: number): Candidate | null {
  if (!cands.length) return null;
  const score = (c: Candidate) => c.ctx + c.pos + c.body;
  cands.sort((x, y) => score(y) - score(x));
  const best = cands[0];
  if (cands.length > 1 && score(best) - score(cands[1]) < MARGIN) return null; // ambiguous
  // Confident when the context vouches for it, when it is exactly where it was stored (and clearly better than the rest), or when it is the only place a distinctive quote occurs.
  const confident = best.ctx + best.body >= CONFIDENCE || best.exactStored || (cands.length === 1 && quoteLength >= DISTINCTIVE);
  return confident ? best : null;
}

/**
 * Re-anchor against (possibly revised) blocks and say what happened: `ok` (the quote and its context are still at the
 * stored position), `moved` (found again elsewhere, confidently and unambiguously) or `orphaned` (the passage is gone,
 * changed beyond recognition, or several places fit equally well: no mark is better than a wrong mark).
 */
export function resolveAnchorDetailed(blocks: Block[], a: Anchor, idx: Map<string, number> = blockIndex(blocks)): { anchor: Anchor | null; status: AnchorStatus } {
  const orphan = { anchor: null, status: "orphaned" as const };
  if (!a.quote) return orphan;
  const si0 = idx.get(a.start.b);
  const ei0 = idx.get(a.end.b);
  const single = a.start.b === a.end.b;

  // Fast path: the quote and its context are still exactly where they were stored.
  let stored: Place | null = null;
  if (si0 !== undefined && ei0 !== undefined && si0 <= ei0 && a.start.o <= blocks[si0].text.length && a.end.o <= blocks[ei0].text.length) {
    stored = { si: si0, so: a.start.o, ei: ei0, eo: a.end.o };
    if (quoteAt(blocks, stored) === a.quote) {
      const f = contextFractions(blocks, a, stored);
      // Prefix and suffix must agree exactly; a neighbouring block may have been edited a little.
      if ((f.prefix ?? 1) === 1 && (f.suffix ?? 1) === 1 && (f.prevBlock ?? 1) >= 0.5 && (f.nextBlock ?? 1) >= 0.5) return { anchor: a, status: "ok" };
    } else stored = null;
  }

  const cands: Candidate[] = [];
  const proximity = (place: Place) => {
    if (si0 === undefined || place.si !== si0) return 0;
    return 1 + 1 - Math.min(1, Math.abs(place.so - a.start.o) / 500);
  };
  const isStored = (place: Place) => !!stored && place.si === stored.si && place.so === stored.so && place.ei === stored.ei && place.eo === stored.eo;

  if (single) {
    // One block: find every occurrence of the quote (a newline inside the quote is part of a `pre` block's text, not a block break).
    for (let i = 0; i < blocks.length; i++) {
      const t = blocks[i].text;
      for (let from = 0; ; ) {
        const o = t.indexOf(a.quote, from);
        if (o < 0) break;
        const place = { si: i, so: o, ei: i, eo: o + a.quote.length };
        cands.push({ place, ctx: contextScore(contextFractions(blocks, a, place)), pos: proximity(place), exactStored: isStored(place), body: 0 });
        from = o + 1;
      }
    }
  } else {
    // Several blocks: the first line must be the end of a block, the last line the start of a later one, the lines between are whole blocks (which may have been edited).
    const lines = a.quote.split("\n");
    const first = lines[0];
    const last = lines[lines.length - 1];
    const span = lines.length;
    const storedSpan = si0 !== undefined && ei0 !== undefined ? ei0 - si0 + 1 : span;
    // A block with a newline of its own makes the line count ambiguous; then only the exact stored position can be trusted.
    if (storedSpan === span) {
      for (let i = 0; i < blocks.length - 1; i++) {
        if (!blocks[i].text.endsWith(first)) continue;
        const so = blocks[i].text.length - first.length;
        // The end block normally sits `span - 1` blocks further on; tolerate a block removed or added in between.
        for (let j = i + 1; j <= Math.min(blocks.length - 1, i + span + 1); j++) {
          if (!blocks[j].text.startsWith(last)) continue;
          const place = { si: i, so, ei: j, eo: last.length };
          let body = 0;
          if (j - i + 1 === span) {
            const middle = lines.slice(1, -1);
            if (middle.length) body = (2 * middle.filter((l, k) => blocks[i + 1 + k].text === l).length) / middle.length;
            else body = 1;
          }
          cands.push({ place, ctx: contextScore(contextFractions(blocks, a, place)), pos: proximity(place) - Math.abs(j - i + 1 - span) * 0.5, exactStored: isStored(place), body });
        }
      }
    }
  }

  // Nothing matched exactly: the text may have been re-imported with different Unicode normalisation or typographic quotes.
  if (single && !cands.length) {
    const fq = fold(a.quote);
    if (fq) {
      for (let i = 0; i < blocks.length; i++) {
        const f = foldedBlock(blocks, i);
        for (let from = 0; ; ) {
          const o = f.text.indexOf(fq, from);
          if (o < 0) break;
          const place = { si: i, so: f.from[o], ei: i, eo: f.to[o + fq.length - 1] };
          cands.push({ place, ctx: contextScore(contextFractions(blocks, a, place)), pos: proximity(place), exactStored: isStored(place), body: 0 });
          from = o + 1;
        }
      }
    }
  }

  const best = pick(cands, a.quote.length);
  if (!best) return orphan;
  const p = best.place;
  return { anchor: makeAnchor(blocks, { b: blocks[p.si].id, o: p.so }, { b: blocks[p.ei].id, o: p.eo }, idx), status: "moved" };
}

export interface Resolved<T> {
  item: T;
  /** Where the item's passage is now; null when it is orphaned, or when the item has no anchor at all. */
  anchor: Anchor | null;
  /** `orphaned` only when the item has an anchor that could not be found again. */
  status: AnchorStatus;
}

/** Resolutions are cached per (blocks, anchor object): documents and stored anchors are immutable, and hover/active/streaming re-renders must not search again. */
const cache = new WeakMap<Block[], WeakMap<Anchor, { anchor: Anchor | null; status: AnchorStatus }>>();
export function resolveCached(blocks: Block[], a: Anchor, idx?: Map<string, number>) {
  let per = cache.get(blocks);
  if (!per) cache.set(blocks, (per = new WeakMap()));
  let r = per.get(a);
  if (!r) per.set(a, (r = resolveAnchorDetailed(blocks, a, idx)));
  return r;
}

/** Resolve every item once: the single source of truth for painting marks, clicking them, margin cards, the rail and the notebook. */
export function resolveAll<T extends { anchor: Anchor | null }>(blocks: Block[], items: T[], idx: Map<string, number> = blockIndex(blocks)): Resolved<T>[] {
  return items.map((item) => (item.anchor ? { item, ...resolveCached(blocks, item.anchor, idx) } : { item, anchor: null, status: "ok" as const }));
}

/**
 * Re-anchor against (possibly revised) blocks. Returns the anchor unchanged when the quote and its context still sit at the
 * stored offsets, otherwise looks for the quote elsewhere and accepts it only when the evidence is strong and the best
 * place is clearly better than any other. Returns null (orphan) when the text is gone or the match would be a guess.
 */
export function resolveAnchor(blocks: Block[], a: Anchor, idx?: Map<string, number>): Anchor | null {
  return resolveAnchorDetailed(blocks, a, idx).anchor;
}

export interface MarkSpan {
  id: string;
  kind: string;
  start: number;
  end: number;
  data?: Record<string, string | undefined>;
}

export interface Segment {
  start: number;
  end: number;
  marks: MarkSpan[];
}

/** Project anchors onto one block, returning non-overlapping segments with their marks. */
export function segmentBlock(
  block: Block,
  blocks: Block[],
  marks: { id: string; kind: string; anchor: Anchor; data?: Record<string, string | undefined> }[],
  idx: Map<string, number> = blockIndex(blocks),
): Segment[] {
  const bi = idx.get(block.id) ?? -1;
  const spans: MarkSpan[] = [];
  for (const m of marks) {
    const si = idx.get(m.anchor.start.b) ?? -1;
    const ei = idx.get(m.anchor.end.b) ?? -1;
    if (si < 0 || ei < 0 || bi < si || bi > ei) continue;
    // Offsets are clamped to the block: marks that do not come from resolveAnchor (pending, search hit, speech) may be stale.
    const start = clamp(bi === si ? m.anchor.start.o : 0, 0, block.text.length);
    const end = clamp(bi === ei ? m.anchor.end.o : block.text.length, 0, block.text.length);
    if (end <= start) continue;
    spans.push({ id: m.id, kind: m.kind, start, end, data: m.data });
  }
  const cuts = new Set<number>([0, block.text.length]);
  spans.forEach((s) => {
    cuts.add(s.start);
    cuts.add(s.end);
  });
  const points = [...cuts].sort((a, b) => a - b);
  const segs: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    segs.push({ start, end, marks: spans.filter((s) => s.start <= start && s.end >= end) });
  }
  return segs;
}

/**
 * Convert a DOM Selection inside `.prose-read` into an Anchor.
 *
 * Browsers describe a triple-click as "from the start of this paragraph to offset 0 of the next block" (and, on the last
 * paragraph, to somewhere outside every block). Those shapes are normalised so the anchor covers exactly the paragraph:
 * an end at the very start of a later block becomes the end of the previous block, a start at the very end of a block
 * becomes the start of the next one, and an end (or start) outside any block is clamped to the last (first) block the
 * range touches.
 */
export function anchorFromSelection(sel: Selection, blocks: Block[]): Anchor | null {
  if (sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const idx = blockIndex(blocks);
  let s = pointFromNode(range.startContainer, range.startOffset);
  let e = pointFromNode(range.endContainer, range.endOffset);
  if (!s || !e) {
    const touched = touchedBlocks(range, idx);
    if (!touched) return null;
    s ??= { b: blocks[touched.first].id, o: 0 };
    e ??= { b: blocks[touched.last].id, o: blocks[touched.last].text.length };
  }
  const si = idx.get(s.b);
  const ei = idx.get(e.b);
  if (si === undefined || ei === undefined) return null; // the page and the blocks disagree: no anchor rather than a wrong one
  if (ei > si && e.o === 0) e = { b: blocks[ei - 1].id, o: blocks[ei - 1].text.length };
  if (ei > si && s.o >= blocks[si].text.length) s = { b: blocks[si + 1].id, o: 0 };
  // Never cut a grapheme in two (an emoji with a skin tone, a letter with its accent): widen to whole characters.
  s = { b: s.b, o: snapToGrapheme(blocks[idx.get(s.b)!].text, s.o, "start") };
  e = { b: e.b, o: snapToGrapheme(blocks[idx.get(e.b)!].text, e.o, "end") };
  if (comparePoints(s, e, idx) >= 0) return null;
  const a = makeAnchor(blocks, s, e, idx);
  if (!a.quote.trim()) return null;
  return a;
}

/** First and last block (by index) whose element the range touches, or null when it touches none. */
function touchedBlocks(range: Range, idx: Map<string, number>): { first: number; last: number } | null {
  let first = Infinity;
  let last = -Infinity;
  document.querySelectorAll<HTMLElement>(".blk[data-block]").forEach((el) => {
    const i = idx.get(el.dataset.block ?? "");
    if (i === undefined || !range.intersectsNode(el)) return;
    first = Math.min(first, i);
    last = Math.max(last, i);
  });
  return last >= 0 ? { first, last } : null;
}

/**
 * Map a DOM boundary point (node + offset) to a block id and a plain-text offset, or null when it lies outside every block.
 * The offset is the number of text characters between the start of the block's text and the boundary, wherever the
 * boundary sits (inside a text node, between inline elements, at the end of an element such as `(em, 1)`).
 */
export function pointFromNode(node: Node, offset: number): AnchorPoint | null {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const blk = el?.closest<HTMLElement>(".blk");
  const text = blk?.querySelector<HTMLElement>(".blk-text");
  if (!blk || !text || !blk.dataset.block) return null;
  const r = document.createRange();
  r.setStart(text, 0);
  // A boundary before the text (the paragraph-number gutter) collapses the range to it: offset 0.
  r.setEnd(node, offset);
  return { b: blk.dataset.block, o: r.toString().length };
}

/** DOM Range for an anchor (used to position the lens and to flash). */
export function rangeForAnchor(root: ParentNode, a: Anchor): Range | null {
  const s = nodeForPoint(root, a.start);
  const e = nodeForPoint(root, a.end);
  if (!s || !e) return null;
  const r = document.createRange();
  r.setStart(s.node, s.offset);
  r.setEnd(e.node, e.offset);
  return r;
}

function nodeForPoint(root: ParentNode, p: AnchorPoint): { node: Node; offset: number } | null {
  const blk = root.querySelector<HTMLElement>(`.blk[data-block="${CSS.escape(p.b)}"] .blk-text`);
  if (!blk) return null;
  const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
  let o = 0;
  let n: Node | null;
  let last: Node | null = null;
  while ((n = walker.nextNode())) {
    const len = n.textContent?.length ?? 0;
    if (p.o <= o + len) return { node: n, offset: p.o - o };
    o += len;
    last = n;
  }
  if (last) return { node: last, offset: last.textContent?.length ?? 0 };
  return { node: blk, offset: 0 };
}

/** Ids of the blocks an anchor spans (none when its start block is not in `blocks`). */
export function anchorBlockIds(blocks: Block[], a: Anchor): string[] {
  const idx = blockIndex(blocks);
  const si = idx.get(a.start.b);
  if (si === undefined) return [];
  const ei = idx.get(a.end.b) ?? si;
  return blocks.slice(si, ei + 1).map((b) => b.id);
}
