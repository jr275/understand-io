"use client";

import { memo, type ReactNode } from "react";
import { MessageCirclePlus } from "lucide-react";
import type { Block as BlockT, Run } from "@/lib/content/types";
import type { Segment } from "@/lib/anchors";

interface Props {
  block: BlockT;
  first: boolean;
  cursor: boolean;
  speaking: boolean;
  flash: boolean;
  read: boolean;
  segments: Segment[];
  onAsk: (blockId: string) => void;
  onMarkClick: (id: string, kind: string, e: React.MouseEvent) => void;
  onMarkHover: (id: string | null, kind: string) => void;
  hasNote: boolean;
}

const MARK_CLASS: Record<string, string> = { hl: "m-hl", ul: "m-ul", note: "m-note", gloss: "m-gloss", pending: "m-pending", speak: "m-speak", hit: "hit-mark" };

function styleRun(r: Run, children: ReactNode, key: number) {
  let node: ReactNode = children;
  if (r.code) node = <code key={key}>{node}</code>;
  if (r.strong) node = <strong key={key}>{node}</strong>;
  if (r.em) node = <em key={key}>{node}</em>;
  if (r.href)
    node = (
      <a key={key} href={r.href} target="_blank" rel="noopener noreferrer">
        {node}
      </a>
    );
  return typeof node === "string" ? <span key={key}>{node}</span> : node;
}

/** Slice the block's runs between [start, end) preserving inline styling. */
function runsBetween(runs: Run[], start: number, end: number): ReactNode[] {
  const out: ReactNode[] = [];
  let pos = 0;
  runs.forEach((r, i) => {
    const rs = pos;
    const re = pos + r.text.length;
    pos = re;
    if (re <= start || rs >= end) return;
    const slice = r.text.slice(Math.max(start, rs) - rs, Math.min(end, re) - rs);
    if (slice) out.push(styleRun(r, slice, i));
  });
  return out;
}

export const Block = memo(function Block({ block, first, cursor, speaking, flash, read, segments, onAsk, onMarkClick, onMarkHover, hasNote }: Props) {
  const runs = block.runs?.length ? block.runs : [{ text: block.text }];
  const Tag = block.type === "h2" ? "h2" : block.type === "h3" ? "h3" : "div";
  const cls = ["blk", first ? "is-first" : "", cursor ? "is-cursor" : "", speaking ? "is-speaking" : "", flash ? "is-flash" : ""].filter(Boolean).join(" ");

  const content = segments.length
    ? segments.map((seg, i) => {
        const inner = runsBetween(runs, seg.start, seg.end);
        if (!seg.marks.length) return <span key={i}>{inner}</span>;
        // Nest marks: outermost gloss/note, then highlight, then transient marks.
        const order = ["gloss", "note", "ul", "hl", "hit", "speak", "pending"];
        const marks = [...seg.marks].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
        return marks.reduceRight<ReactNode>(
          (child, m) => (
            <span
              key={m.id}
              className={`${MARK_CLASS[m.kind] ?? ""} ${m.data?.state ?? ""}`}
              data-c={m.data?.color}
              data-mark={m.id}
              onClick={m.kind === "hl" || m.kind === "ul" || m.kind === "note" || m.kind === "gloss" ? (e) => onMarkClick(m.id, m.kind, e) : undefined}
              onMouseEnter={m.kind === "gloss" || m.kind === "note" ? () => onMarkHover(m.id, m.kind) : undefined}
              onMouseLeave={m.kind === "gloss" || m.kind === "note" ? () => onMarkHover(null, m.kind) : undefined}
            >
              {child}
            </span>
          ),
          <span key={`s${i}`}>{inner}</span>,
        );
      })
    : runs.map((r, i) => styleRun(r, r.text, i));

  return (
    <Tag className={cls} data-block={block.id} data-type={block.type} data-n={block.n} data-read={read ? "" : undefined}>
      {block.n ? (
        <button type="button" className="pnum" aria-label={`Ask about paragraph ${block.n}`} data-tip={`Ask about ¶${block.n}`} data-tip-side="left" onClick={() => onAsk(block.id)}>
          <span className="pnum-ask" aria-hidden="true">
            <MessageCirclePlus size={12} aria-hidden="true" />
          </span>
          {block.n}
        </button>
      ) : null}
      {block.type === "figure" && block.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="fig-img" src={block.src} alt={block.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />
      ) : null}
      <span className="blk-text">
        {content}
        {hasNote ? <span className="note-dot" aria-hidden="true" /> : null}
      </span>
    </Tag>
  );
});
