"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, ChevronsDownUp, Copy, RotateCcw, Trash2, X } from "lucide-react";
import { NOTE_MAX_LENGTH, type Anchor, type Annotation, type Block, type Gloss } from "@/lib/content/types";
import { clampNote, rangeForAnchor } from "@/lib/anchors";
import { plainAnswer, renderGlossBody } from "./glossMarkdown";

export interface MarginItem {
  id: string;
  /** `orphan`: a highlight, underline or note whose passage could not be found in the text any more. */
  kind: "gloss" | "note" | "orphan";
  gloss?: Gloss;
  note?: Annotation;
  /** Where the passage is now (resolved once by the reader); null for whole-text glosses and orphans. */
  anchor: Anchor | null;
  /** The item has an anchor that could not be found again: it is listed in the "couldn't find this passage" group instead of next to the text. */
  orphaned: boolean;
}

interface Props {
  items: MarginItem[];
  blocks: Block[];
  rootRef: RefObject<HTMLElement | null>;
  activeId: string | null;
  hoverId: string | null;
  layoutKey: string;
  onActivate: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onDeleteGloss: (id: string) => void;
  onRetry: (id: string) => void;
  onFollowUp: (id: string, q: string) => void;
  onCite: (n: number) => void;
  onEditNote: (id: string, text: string) => void;
  onDeleteNote: (id: string) => void;
  /** Below 1080px the active item is shown as a bottom sheet instead. */
  sheet: boolean;
  /** Offset (px) of the first paragraph, used to place the empty-margin hint. */
  emptyTop?: number;
}

const ACTION_LABEL: Record<string, string> = { explain: "Explain", simplify: "Simplify", ask: "Ask", define: "Define", factcheck: "Fact-check", related: "Related", counterpoint: "Counterpoint", overview: "Gloss", whole: "Whole text" };

/** Right-margin column: glosses and notes aligned to their anchors, with SVG leaders. */
export function MarginGlosses(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const [pos, setPos] = useState<Map<string, { y: number; anchorY: number }>>(new Map());
  const [minH, setMinH] = useState(0);
  const [orphanTop, setOrphanTop] = useState<number | null>(null);

  // Measure anchors and stack cards without overlap; the active card keeps its anchor position.
  useLayoutEffect(() => {
    const root = p.rootRef.current;
    const w = wrap.current;
    if (!root || !w || p.sheet) return;
    const wTop = w.getBoundingClientRect().top + window.scrollY;
    const desired = p.items
      .filter((it) => !it.orphaned)
      .map((it) => {
        const a = it.anchor;
        let anchorY = 0;
        if (a) {
          const r = rangeForAnchor(root, a);
          const rect = r?.getClientRects()[0] ?? r?.getBoundingClientRect();
          if (rect) anchorY = rect.top + window.scrollY - wTop;
        } else {
          const header = root.querySelector(".blk");
          if (header) anchorY = header.getBoundingClientRect().top + window.scrollY - wTop - 10;
        }
        const h = refs.current.get(it.id)?.offsetHeight ?? 60;
        return { id: it.id, anchorY, h };
      })
      .sort((a, b) => a.anchorY - b.anchorY);
    const next = new Map<string, { y: number; anchorY: number }>();
    const activeIdx = desired.findIndex((d) => d.id === p.activeId);
    // Place active first, then push others above/below.
    let y = 0;
    const placed: { id: string; y: number; h: number }[] = [];
    if (activeIdx >= 0) {
      const a = desired[activeIdx];
      placed.push({ id: a.id, y: a.anchorY - 6, h: a.h });
      // above
      let top = a.anchorY - 6;
      for (let i = activeIdx - 1; i >= 0; i--) {
        const d = desired[i];
        const yy = Math.min(d.anchorY - 6, top - d.h - 8);
        placed.push({ id: d.id, y: yy, h: d.h });
        top = yy;
      }
      let bottom = a.anchorY - 6 + a.h;
      for (let i = activeIdx + 1; i < desired.length; i++) {
        const d = desired[i];
        const yy = Math.max(d.anchorY - 6, bottom + 8);
        placed.push({ id: d.id, y: yy, h: d.h });
        bottom = yy + d.h;
      }
    } else {
      for (const d of desired) {
        const yy = Math.max(d.anchorY - 6, y);
        placed.push({ id: d.id, y: yy, h: d.h });
        y = yy + d.h + 8;
      }
    }
    let maxBottom = 0;
    for (const pl of placed) {
      const d = desired.find((x) => x.id === pl.id)!;
      next.set(pl.id, { y: Math.max(0, pl.y), anchorY: d.anchorY });
      maxBottom = Math.max(maxBottom, pl.y + pl.h);
    }
    // Items whose passage is gone are stacked below everything else, under their own heading.
    const orphans = p.items.filter((it) => it.orphaned);
    if (orphans.length) {
      const head = maxBottom > 0 ? maxBottom + 24 : 0;
      let oy = head + 30;
      for (const it of orphans) {
        next.set(it.id, { y: oy, anchorY: -1 });
        oy += (refs.current.get(it.id)?.offsetHeight ?? 90) + 8;
      }
      maxBottom = oy;
      setOrphanTop(head);
    } else setOrphanTop(null);
    setPos(next);
    setMinH(maxBottom + 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.items, p.activeId, p.layoutKey, p.sheet, p.blocks]);

  const active = p.items.find((i) => i.id === p.activeId) ?? null;

  if (p.sheet) {
    if (!active) return null;
    return (
      <div className="fixed inset-x-0 bottom-0 z-[48] mx-auto max-w-[640px] px-2 pb-2" style={{ animation: "sheet-up .35s var(--ease-out)" }}>
        <div className="relative max-h-[60dvh] overflow-y-auto rounded-[18px] border border-rule bg-raised shadow-pop scroll-thin">
          <span aria-hidden="true" className="mx-auto mt-2 block h-1 w-10 rounded-full bg-rule-strong" />
          <div className="relative px-1 pb-1">
            <Card item={active} p={p} bare refCb={() => {}} />
          </div>
          <button type="button" aria-label="Close" className="absolute right-3 top-3 grid size-7 place-items-center rounded-full text-ink-4 hover:bg-sunk hover:text-ink" onClick={() => p.onActivate(null)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  if (!p.items.length) {
    return (
      <div ref={wrap} className="relative">
        <p className="focus-hide absolute left-0 right-0 border-l border-rule pl-4 text-[13.5px] leading-[1.55] text-ink-3" style={{ top: p.emptyTop ?? 0, animation: "fade .6s .4s var(--ease-out) both" }}>
          <span className="block text-ink-2">This area is for notes.</span>
          Select any passage, then just start typing to ask.
        </p>
      </div>
    );
  }

  return (
    <div ref={wrap} className="relative" style={{ minHeight: minH }}>
      <svg className="pointer-events-none absolute top-0 overflow-visible" aria-hidden="true" style={{ left: -64, width: 64, height: Math.max(minH, 10) }}>
        {p.items.map((it) => {
          const q = pos.get(it.id);
          if (!q || it.orphaned) return null;
          const on = it.id === p.activeId || it.id === p.hoverId;
          const x0 = 10;
          const y0 = q.anchorY + 10;
          const x1 = 64;
          const y1 = q.y + 14;
          return (
            <g key={it.id} opacity={on ? 1 : 0.45}>
              <path className="leader" d={`M${x0} ${y0} C ${x0 + 24} ${y0}, ${x1 - 22} ${y1}, ${x1} ${y1}`} />
              <circle cx={x0} cy={y0} r={2.4} fill={on ? "var(--rubric)" : "var(--rule-strong)"} />
            </g>
          );
        })}
      </svg>
      {orphanTop !== null ? (
        <h3 data-testid="orphan-heading" className="absolute left-0 right-0 border-t border-rule pt-2 text-[12px] font-semibold uppercase leading-none tracking-[0.04em] text-rubric-text" style={{ top: orphanTop }}>
          Couldn&rsquo;t find this passage
        </h3>
      ) : null}
      {p.items.map((it) => (
        <Card key={it.id} item={it} p={p} y={pos.get(it.id)?.y ?? 0} refCb={(el) => (el ? refs.current.set(it.id, el) : refs.current.delete(it.id))} />
      ))}
    </div>
  );
}

function Card({ item, p, y = 0, bare = false, refCb }: { item: MarginItem; p: Props; y?: number; bare?: boolean; refCb: (el: HTMLElement | null) => void }) {
  const active = item.id === p.activeId;
  const hover = item.id === p.hoverId;
  const style = bare ? { position: "relative" as const } : { transform: `translateY(${y}px)` };

  if (item.kind === "orphan" && item.note) {
    const o = item.note;
    return (
      <article ref={refCb} data-orphan={o.id} aria-label={`${o.kind === "note" ? "Note" : o.kind === "underline" ? "Underline" : "Highlight"}: couldn't find this passage`} className="mnote is-active" style={{ ...style, ["--note-c" as string]: `var(--mk-${o.color ?? "yellow"})` }}>
        <p className="mb-1.5 text-[11.5px] font-medium text-ink-3">{o.kind === "note" ? "Note" : o.kind === "underline" ? "Underline" : "Highlight"}</p>
        <p className="line-clamp-3 border-l-2 border-[var(--rubric-line)] pl-2.5 font-serif text-[14.5px] leading-snug text-ink-3">{o.anchor.quote}</p>
        {o.note ? <p className="mt-2 whitespace-pre-wrap font-serif text-[15px] leading-[1.45]">{o.note}</p> : null}
        <span className="mt-1.5 flex items-center justify-end font-sans text-[11.5px] text-ink-4">
          <button type="button" aria-label="Delete" className="grid size-6 place-items-center rounded-md hover:bg-sunk hover:text-ink" onClick={() => p.onDeleteNote(o.id)}>
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </span>
      </article>
    );
  }

  if (item.kind === "note" && item.note) {
    const n = item.note;
    return (
      <NoteCard
        key={n.id}
        n={n}
        active={active}
        style={style}
        refCb={refCb}
        onActivate={() => p.onActivate(active ? null : n.id)}
        onEdit={(t) => p.onEditNote(n.id, t)}
        onDelete={() => p.onDeleteNote(n.id)}
        onHover={(h) => p.onHover(h ? n.id : null)}
        pn={item.anchor ? p.blocks.find((b) => b.id === item.anchor!.start.b)?.n : undefined}
      />
    );
  }
  const g = item.gloss!;
  const n = item.anchor ? p.blocks.find((b) => b.id === item.anchor!.start.b)?.n : undefined;
  const label = ACTION_LABEL[g.action] ?? "Ask";
  const answer = g.turns.filter((t) => t.role === "assistant").slice(-1)[0]?.content ?? "";
  const question = g.action === "ask" || g.action === "whole" ? g.turns.find((t) => t.role === "user")?.content : undefined;
  const streaming = g.status === "streaming";

  if (!active && !bare) {
    return (
      <article
        ref={refCb}
        data-gloss={g.id}
        aria-label={`${label}, paragraph ${n ?? "—"}. Open note.`}
        role="button"
        tabIndex={0}
        className={`gloss is-collapsed ${hover ? "is-hover" : ""}`}
        style={style}
        onClick={() => p.onActivate(g.id)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && p.onActivate(g.id)}
        onMouseEnter={() => p.onHover(g.id)}
        onMouseLeave={() => p.onHover(null)}
      >
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium leading-[1.4] text-ink">
            <span className="text-rubric-text">{label}</span>
            {g.anchor ? <span className="font-normal text-ink-2"> “{g.anchor.quote}”</span> : question ? <span className="font-normal text-ink-2"> {question}</span> : null}
          </p>
          {n ? <span className="shrink-0 text-[11px] tabular-nums text-ink-4">¶{n}</span> : null}
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-[1.45] text-ink-3">{g.error ? g.error : plainAnswer(answer) || (streaming ? "Writing…" : "")}</p>
      </article>
    );
  }

  return (
    <article ref={refCb} data-gloss={g.id} aria-label={`${label} note on paragraph ${n ?? "—"}`} className={`gloss is-active ${g.status === "streaming" ? "is-entering" : ""}`} style={style} onMouseEnter={() => p.onHover(g.id)} onMouseLeave={() => p.onHover(null)}>
      <header className="mb-2 flex h-5 items-center gap-2 text-[12px] leading-none">
        <span className="font-semibold text-rubric-text">{label}</span>
        {n ? (
          <button type="button" className="cite !text-[11px]" aria-label={`Go to paragraph ${n}`} data-tip="Show in the text" onClick={() => p.onCite(n)}>
            ¶{n}
          </button>
        ) : null}
        <button type="button" aria-label="Collapse note" data-tip="Collapse" data-tip-kbd="Esc" className="-mr-1.5 ml-auto grid size-6 place-items-center rounded-md text-ink-4 transition-colors hover:bg-sunk hover:text-ink" onClick={() => p.onActivate(null)}>
          <ChevronsDownUp size={14} aria-hidden="true" />
        </button>
      </header>
      {g.anchor ? <p className="mb-2.5 line-clamp-2 border-l-2 border-[var(--rubric-line)] pl-2.5 font-serif text-[15px] leading-snug text-ink-3">{g.anchor.quote}</p> : null}
      {question ? <p className="mb-2 font-serif text-[16px] leading-[1.35] text-ink [font-variation-settings:'opsz'_24]">{question}</p> : null}
      <div className="gloss-body">
        {g.error ? (
          <p className="text-rubric-text">{g.error}</p>
        ) : answer ? (
          renderGlossBody(answer, p.onCite, streaming)
        ) : streaming ? (
          <div className="writing" aria-label="Writing">
            <span style={{ width: "92%" }} />
            <span style={{ width: "78%" }} />
            <span style={{ width: "60%" }} />
          </div>
        ) : null}
      </div>
      <footer className="mt-3 flex items-center gap-0.5 text-ink-3">
        <span className="min-w-0 flex-1 truncate text-[11.5px] tabular-nums text-ink-4">
          {g.model ? (
            <span data-tip={g.usage ? `${g.usage.input.toLocaleString()} prompt tokens, ${g.usage.output.toLocaleString()} written` : undefined}>
              {shortModel(g.model)}
              {g.usage ? (
                <>
                  <span className="mx-1.5 text-ink-4/70">/</span>
                  {fmtK(g.usage.input)} in, {fmtK(g.usage.output)} out
                  {g.usage.cost !== undefined ? (
                    <>
                      <span className="mx-1.5 text-ink-4/70">/</span>~${g.usage.cost.toFixed(4)}
                    </>
                  ) : null}
                </>
              ) : null}
            </span>
          ) : streaming ? (
            "Writing…"
          ) : null}
        </span>
        <button type="button" aria-label="Try again" data-tip="Try again" className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-sunk hover:text-ink" onClick={() => p.onRetry(g.id)}>
          <RotateCcw size={14} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Copy" data-tip="Copy" className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-sunk hover:text-ink" onClick={() => void navigator.clipboard?.writeText(plainAnswer(answer))}>
          <Copy size={14} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Delete" data-tip="Delete" className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-sunk hover:text-ink" onClick={() => p.onDeleteGloss(g.id)}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </footer>
      <FollowUp disabled={streaming} onSend={(q) => p.onFollowUp(g.id, q)} />
    </article>
  );
}

function FollowUp({ onSend, disabled }: { onSend: (q: string) => void; disabled: boolean }) {
  const [q, setQ] = useState("");
  return (
    <form
      data-field
      className="mt-2.5 flex items-center gap-1.5 rounded-[10px] border border-rule bg-bg px-2.5 transition-colors focus-within:border-rule-strong"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) {
          onSend(q.trim());
          setQ("");
        }
      }}
    >
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a follow-up" aria-label="Ask a follow-up" disabled={disabled} className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-4 focus-visible:outline-none" />
      <button type="submit" disabled={!q.trim() || disabled} aria-label="Send follow-up" data-tip="Send" data-tip-kbd="↵" className="grid size-6 place-items-center rounded-md bg-ink text-bg transition-opacity disabled:opacity-20">
        <ArrowUp size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </form>
  );
}

function NoteCard({ n, active, style, refCb, onActivate, onEdit, onDelete, onHover, pn }: { n: Annotation; active: boolean; style: React.CSSProperties; refCb: (el: HTMLElement | null) => void; onActivate: () => void; onEdit: (t: string) => void; onDelete: () => void; onHover: (h: boolean) => void; pn?: number }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(n.note ?? "");
  if (editing) {
    return (
      <form
        ref={refCb as never}
        className="mnote is-active"
        style={{ ...style, ["--note-c" as string]: `var(--mk-${n.color ?? "yellow"})` }}
        onSubmit={(e) => {
          e.preventDefault();
          onEdit(text.trim());
          setEditing(false);
        }}
      >
        <textarea autoFocus value={text} maxLength={NOTE_MAX_LENGTH} onChange={(e) => setText(clampNote(e.target.value))} rows={3} aria-label="Edit note" className="w-full resize-none bg-transparent font-serif text-[15px] leading-[1.45] text-ink outline-none" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }} />
        <div className="mt-1 flex items-center justify-between text-[11.5px] text-ink-4">
          <span>
            ↵ to keep · <span data-testid="note-counter" className={`tabular-nums ${text.length >= NOTE_MAX_LENGTH - 200 ? "text-[var(--rubric)]" : ""}`}>{text.length}/{NOTE_MAX_LENGTH}</span>
          </span>
          <span className="flex gap-1">
            <button type="button" className="rounded px-2 py-0.5 hover:bg-sunk hover:text-ink" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="rounded bg-ink px-2 py-0.5 text-bg">Keep</button>
          </span>
        </div>
      </form>
    );
  }
  return (
    <div ref={refCb} className={`mnote ${active ? "is-active" : ""}`} style={{ ...style, ["--note-c" as string]: `var(--mk-${n.color ?? "yellow"})` }} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <button type="button" aria-label={`Note on paragraph ${pn ?? "—"}`} className="block w-full text-left font-serif text-inherit" onClick={() => (active ? (setText(n.note ?? ""), setEditing(true)) : onActivate())}>
        <span className="block whitespace-pre-wrap">{n.note || <span className="text-ink-4">Empty note</span>}</span>
      </button>
      {active ? (
        <span className="mt-1.5 flex items-center justify-between font-sans text-[11.5px] text-ink-4">
          <span>{pn ? `¶${pn} · ` : ""}click to edit</span>
          <button type="button" aria-label="Delete note" className="grid size-6 place-items-center rounded-md hover:bg-sunk hover:text-ink" onClick={onDelete}>
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </span>
      ) : null}
    </div>
  );
}

function fmtK(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function shortModel(m: string) {
  return m.split("/").pop()?.replace(/-/g, " ") ?? m;
}
