import type { Anchor, AnchorPoint, Block } from "@/lib/content/types";

const CONTEXT = 32;

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

/** Build an anchor from block ids and offsets, filling in the quote and context. */
export function makeAnchor(blocks: Block[], start: AnchorPoint, end: AnchorPoint): Anchor {
  const idx = blockIndex(blocks);
  let s = start;
  let e = end;
  if (comparePoints(s, e, idx) > 0) [s, e] = [e, s];
  const parts: string[] = [];
  const si = idx.get(s.b) ?? 0;
  const ei = idx.get(e.b) ?? si;
  for (let i = si; i <= ei; i++) {
    const t = blocks[i].text;
    const from = i === si ? s.o : 0;
    const to = i === ei ? e.o : t.length;
    parts.push(t.slice(from, to));
  }
  const quote = parts.join("\n");
  const prefix = blocks[si].text.slice(Math.max(0, s.o - CONTEXT), s.o);
  const suffix = blocks[ei].text.slice(e.o, e.o + CONTEXT);
  return { start: s, end: e, quote, prefix, suffix };
}

/**
 * Re-anchor against (possibly revised) blocks. Returns the anchor unchanged when the
 * quote still matches at the stored offsets, otherwise searches for the quote (using
 * prefix/suffix to disambiguate repeats). Returns null when the text is gone.
 */
export function resolveAnchor(blocks: Block[], a: Anchor): Anchor | null {
  const idx = blockIndex(blocks);
  const sb = blocks[idx.get(a.start.b) ?? -1];
  const eb = blocks[idx.get(a.end.b) ?? -1];
  if (sb && eb) {
    const current = makeAnchor(blocks, a.start, a.end).quote;
    if (current === a.quote) return a;
  }
  const lines = a.quote.split("\n");
  if (lines.length === 1) {
    // Single-block quote: find best candidate across blocks, prefer the original block.
    const candidates: { b: string; o: number; score: number }[] = [];
    for (const b of blocks) {
      let from = 0;
      for (;;) {
        const o = b.text.indexOf(a.quote, from);
        if (o < 0) break;
        let score = b.id === a.start.b ? 2 : 0;
        if (a.prefix && b.text.slice(Math.max(0, o - a.prefix.length), o) === a.prefix) score += 3;
        if (a.suffix && b.text.slice(o + a.quote.length, o + a.quote.length + a.suffix.length) === a.suffix) score += 3;
        if (b.id === a.start.b) score -= Math.abs(o - a.start.o) / 1000;
        candidates.push({ b: b.id, o, score });
        from = o + 1;
      }
    }
    if (!candidates.length) return null;
    candidates.sort((x, y) => y.score - x.score);
    const best = candidates[0];
    return makeAnchor(blocks, { b: best.b, o: best.o }, { b: best.b, o: best.o + a.quote.length });
  }
  // Multi-block: locate the first and last line.
  const first = lines[0];
  const last = lines[lines.length - 1];
  for (let i = 0; i < blocks.length; i++) {
    const so = blocks[i].text.indexOf(first);
    if (so < 0 || so + first.length !== blocks[i].text.length) continue;
    const j = i + lines.length - 1;
    if (j >= blocks.length) continue;
    if (!blocks[j].text.startsWith(last)) continue;
    return makeAnchor(blocks, { b: blocks[i].id, o: so }, { b: blocks[j].id, o: last.length });
  }
  return null;
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
): Segment[] {
  const idx = blockIndex(blocks);
  const bi = idx.get(block.id) ?? -1;
  const spans: MarkSpan[] = [];
  for (const m of marks) {
    const si = idx.get(m.anchor.start.b) ?? -1;
    const ei = idx.get(m.anchor.end.b) ?? -1;
    if (si < 0 || ei < 0 || bi < si || bi > ei) continue;
    const start = bi === si ? m.anchor.start.o : 0;
    const end = bi === ei ? m.anchor.end.o : block.text.length;
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

/** Convert a DOM Selection inside `.prose-read` into an Anchor. */
export function anchorFromSelection(sel: Selection, blocks: Block[]): Anchor | null {
  if (sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const s = pointFromNode(range.startContainer, range.startOffset);
  const e = pointFromNode(range.endContainer, range.endOffset);
  if (!s || !e) return null;
  const a = makeAnchor(blocks, s, e);
  if (!a.quote.trim()) return null;
  return a;
}

/** Map a DOM node + offset to a block id and plain-text offset. */
export function pointFromNode(node: Node, offset: number): AnchorPoint | null {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const blk = el?.closest<HTMLElement>(".blk");
  const text = blk?.querySelector<HTMLElement>(".blk-text");
  if (!blk || !text || !blk.dataset.block) return null;
  let o = 0;
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  if (node.nodeType !== Node.TEXT_NODE) {
    // Element boundary: count text before the child at `offset`.
    const target = node.childNodes[offset] ?? null;
    while ((n = walker.nextNode())) {
      if (target && (n === target || target.contains(n))) break;
      if (target && n.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_PRECEDING) break;
      o += n.textContent?.length ?? 0;
    }
    return { b: blk.dataset.block, o };
  }
  while ((n = walker.nextNode())) {
    if (n === node) {
      o += offset;
      return { b: blk.dataset.block, o };
    }
    o += n.textContent?.length ?? 0;
  }
  return null;
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

export function anchorBlockIds(blocks: Block[], a: Anchor): string[] {
  const idx = blockIndex(blocks);
  const si = idx.get(a.start.b) ?? 0;
  const ei = idx.get(a.end.b) ?? si;
  return blocks.slice(si, ei + 1).map((b) => b.id);
}
