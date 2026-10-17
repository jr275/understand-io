"use client";

import { useEffect, useRef, useState } from "react";
import { AlignLeft, ArrowUp, BookOpenText, Copy, Ellipsis, Feather, Headphones, Eraser, Highlighter, Languages, Lightbulb, Link2, PenLine, ScanSearch, ShieldCheck, Underline } from "lucide-react";
import { NOTE_MAX_LENGTH, type GlossAction, type HighlightColor } from "@/lib/content/types";
import { clampNote } from "@/lib/anchors";

export interface LensProps {
  rect: DOMRect;
  marker: HighlightColor;
  onAction: (a: GlossAction, question?: string) => void;
  onHighlight: (c: HighlightColor) => void;
  onUnderline: (c: HighlightColor) => void;
  /** Highlights/underlines that already cover exactly this selection; the lens then offers to remove them. */
  existing?: { id: string; kind: "highlight" | "underline" }[];
  onRemove?: (ids: string[]) => void;
  onNote: (text: string) => void;
  onCopy: () => void;
  onListen: () => void;
  onClose: () => void;
  onTranslate?: () => void;
  onSummarize?: () => void;
  /** Typing a letter starts a question and Shift+H / Shift+U mark the selection. Off when the reader switched single-key shortcuts off. */
  keyShortcuts?: boolean;
}

const COLORS: { id: HighlightColor; label: string; c: string }[] = [
  { id: "yellow", label: "Yellow", c: "#f2c438" },
  { id: "green", label: "Green", c: "#7cc66f" },
  { id: "blue", label: "Blue", c: "#6aa8f0" },
  { id: "pink", label: "Pink", c: "#f084ac" },
];

/** Selection toolbar ("lens"). Appears above the selection; morphs into an input for Ask / notes. */
export function Lens({ rect, marker, onAction, onHighlight, onUnderline, existing = [], onRemove, onNote, onCopy, onListen, onClose, onTranslate, onSummarize, keyShortcuts = true }: LensProps) {
  const [mode, setMode] = useState<"bar" | "ask" | "note">("bar");
  const [menu, setMenu] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean; width: number }>({ left: 0, top: 0, below: false, width: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(12, Math.min(vw - w - 12, left));
    let top = rect.top - h - 10;
    let below = false;
    if (top < 70) {
      top = rect.bottom + 10;
      below = true;
    }
    setPos({ left, top, below, width: w });
  }, [rect, mode, menu]);

  // Typing while the bar is showing starts a question (reference: "Or just start typing").
  useEffect(() => {
    if (mode !== "bar" || !keyShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      // Space is left alone (it scrolls the page); every other single character starts a question.
      if (e.key.length === 1 && e.key !== " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Shift+H / Shift+U are shortcuts; plain letters start a question ("just start typing").
        if (e.shiftKey && e.key === "H") return onHighlight(marker);
        if (e.shiftKey && e.key === "U") return onUnderline(marker);
        e.preventDefault();
        setText(e.key);
        setMode("ask");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, marker, onHighlight, onUnderline, keyShortcuts]);

  // Open the More menu downward when there is no room above the lens.
  const menuBelow = pos.below || pos.top < 340;
  const arrow = (
    <span aria-hidden="true" className="absolute size-2.5 rotate-45 bg-lens" style={{ left: Math.max(11, Math.min(pos.width - 20, rect.left + rect.width / 2 - pos.left - 5)), [pos.below ? "top" : "bottom"]: -4 }} />
  );

  return (
    <div ref={ref} role="toolbar" aria-label="Actions for the selection" className="lens fixed z-50" data-tip-tone="paper" style={{ left: pos.left, top: pos.top, ["--origin" as string]: pos.below ? "top center" : "bottom center" }}>
      <div className="relative rounded-[14px] bg-lens p-1 text-lens-fg shadow-pop ring-1 ring-black/5">
        {mode === "bar" && (
          <div className="no-scrollbar flex max-w-[calc(100vw-24px)] items-center gap-0.5 overflow-x-auto max-sm:flex-wrap max-sm:justify-center max-sm:overflow-visible">
            {/* On a phone the bar is two rows (words, then marks); from sm up these wrappers disappear and it is one row. */}
            <div className="contents max-sm:flex max-sm:w-full max-sm:flex-wrap max-sm:items-center max-sm:justify-center max-sm:gap-0.5">
            <button type="button" data-tip="Ask" data-tip-hint="Or just start typing" data-tip-side="top" className="lens-btn group gap-2 pl-3 pr-2.5 font-medium max-sm:pl-2.5 max-sm:pr-2" onClick={() => setMode("ask")}>
              Ask<span className="lens-caret" aria-hidden="true" />
            </button>
            <span className="mx-[3px] h-4 w-px shrink-0 bg-lens-mute/30" aria-hidden="true" />
            <button type="button" data-tip="Explain" data-tip-hint="What it means here, and why it is here" data-tip-side="top" className="lens-btn group gap-1.5 pl-2.5 pr-3 max-sm:gap-1 max-sm:px-2" onClick={() => onAction("explain")}>
              <Lightbulb size={15} strokeWidth={1.9} aria-hidden="true" className="text-lens-mute transition-colors group-hover:text-lens-fg" />
              Explain
            </button>
            <button type="button" data-tip="Simplify" data-tip-hint="The same idea in plain words" data-tip-side="top" className="lens-btn group gap-1.5 pl-2.5 pr-3 max-sm:gap-1 max-sm:px-2" onClick={() => onAction("simplify")}>
              <Feather size={15} strokeWidth={1.9} aria-hidden="true" className="text-lens-mute transition-colors group-hover:text-lens-fg" />
              Simplify
            </button>
            {onTranslate ? (
              <button type="button" data-tip="Translate" data-tip-hint="Keeps the original beside it" data-tip-side="top" className="lens-btn group gap-1.5 pl-2.5 pr-3 max-sm:gap-1 max-sm:px-2" onClick={onTranslate}>
                <Languages size={15} strokeWidth={1.9} aria-hidden="true" className="text-lens-mute transition-colors group-hover:text-lens-fg" />
                Translate
              </button>
            ) : null}
            {onSummarize ? (
              <button type="button" data-tip="Summarize" data-tip-hint="Only this passage" data-tip-side="top" className="lens-btn group gap-1.5 pl-2.5 pr-3 max-sm:gap-1 max-sm:px-2" onClick={onSummarize}>
                <AlignLeft size={15} strokeWidth={1.9} aria-hidden="true" className="text-lens-mute transition-colors group-hover:text-lens-fg" />
                Summarize
              </button>
            ) : null}
            </div>
            <div className="contents max-sm:flex max-sm:w-full max-sm:flex-wrap max-sm:items-center max-sm:justify-center max-sm:gap-0.5">
            <div className="relative">
              <button type="button" aria-label="More actions" aria-expanded={menu} data-tip="More" data-tip-hint="Define, fact-check, counterpoint, copy" data-tip-side="top" className="lens-btn w-8 justify-center" onClick={() => setMenu((m) => !m)}>
                <Ellipsis size={16} aria-hidden="true" />
              </button>
              {menu ? (
                <div role="menu" aria-label="More actions" className={`lens-menu absolute right-0 w-[264px] rounded-[14px] bg-lens p-1 text-lens-fg shadow-pop ring-1 ring-black/5 ${menuBelow ? "top-[calc(100%+8px)]" : "bottom-[calc(100%+8px)]"}`} style={{ transformOrigin: menuBelow ? "100% 0" : "100% 100%" }}>
                  {(
                    [
                      ["define", BookOpenText, "Define", "The word, as this author uses it"],
                      ["factcheck", ShieldCheck, "Fact-check", "Does it still hold up?"],
                      ["related", Link2, "Related", "Where else the text takes this up"],
                      ["counterpoint", ScanSearch, "Counterpoint", "The strongest objection to it"],
                    ] as const
                  ).map(([a, Icon, label, hint], i) => (
                    <button key={a} type="button" role="menuitem" className="lens-item group flex w-full items-start gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-lens-hover" style={{ animationDelay: `${i * 30}ms` }} onClick={() => onAction(a)}>
                      <Icon size={15} strokeWidth={1.9} aria-hidden="true" className="mt-0.5 shrink-0 text-lens-mute group-hover:text-lens-fg" />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium leading-tight">{label}</span>
                        <span className="mt-0.5 block text-[12px] leading-snug text-lens-mute">{hint}</span>
                      </span>
                    </button>
                  ))}
                  <span className="mx-2.5 my-1 block h-px bg-lens-mute/15" aria-hidden="true" />
                  <button type="button" role="menuitem" className="lens-item group flex w-full items-start gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-lens-hover" onClick={onListen}>
                    <Headphones size={15} strokeWidth={1.9} aria-hidden="true" className="mt-0.5 shrink-0 text-lens-mute group-hover:text-lens-fg" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium leading-tight">Read aloud</span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-lens-mute">This passage, then carry on</span>
                    </span>
                  </button>
                  <button type="button" role="menuitem" className="lens-item group flex w-full items-start gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-lens-hover" onClick={onCopy}>
                    <Copy size={15} strokeWidth={1.9} aria-hidden="true" className="mt-0.5 shrink-0 text-lens-mute group-hover:text-lens-fg" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium leading-tight">Copy quote</span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-lens-mute">With the title and paragraph number</span>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            <span className="mx-[3px] h-4 w-px shrink-0 bg-lens-mute/30" aria-hidden="true" />
            <div className="group/hl flex items-center">
              <button type="button" aria-label="Highlight" data-tip="Highlight" data-tip-hint="Hover for colours" data-tip-kbd="⇧H" data-tip-side="top" className="lens-btn w-8 justify-center text-lens-fg/85 hover:text-lens-fg" onClick={() => onHighlight(marker)}>
                <span className="relative">
                  <Highlighter size={15} aria-hidden="true" />
                  <span aria-hidden="true" className="absolute -bottom-[3px] -right-[3px] size-[7px] rounded-full ring-2 ring-[var(--lens-bg)]" style={{ background: COLORS.find((c) => c.id === marker)?.c }} />
                </span>
              </button>
              <div className="h-8 w-0 overflow-hidden transition-[width] duration-300 ease-[var(--ease-out)] group-focus-within/hl:w-[94px] group-hover/hl:w-[94px] max-sm:w-[94px]">
                <div className="flex h-full w-[94px] items-center gap-2 px-2">
                  {COLORS.map((c) => (
                    <button key={c.id} type="button" aria-label={`Highlight in ${c.label.toLowerCase()}`} data-tip={c.label} data-tip-side="top" className={`lens-dot ${c.id === marker ? "is-on" : ""}`} style={{ background: c.c }} onClick={() => onHighlight(c.id)} />
                  ))}
                </div>
              </div>
            </div>
            <button type="button" aria-label="Underline" data-tip="Underline" data-tip-kbd="⇧U" data-tip-side="top" className="lens-btn w-8 justify-center text-lens-fg/85 hover:text-lens-fg" onClick={() => onUnderline(marker)}>
              <Underline size={15} aria-hidden="true" />
            </button>
            {(["highlight", "underline"] as const).map((k) => {
              const ids = existing.filter((x) => x.kind === k).map((x) => x.id);
              return ids.length && onRemove ? (
                <button key={k} type="button" aria-label={`Remove ${k}`} data-tip={`Remove ${k}`} data-tip-side="top" className="lens-btn w-8 justify-center text-lens-fg/85 hover:text-lens-fg" onClick={() => onRemove(ids)}>
                  <Eraser size={15} aria-hidden="true" />
                </button>
              ) : null;
            })}
            <button type="button" aria-label="Copy quote" data-tip="Copy quote" data-tip-hint="With the title and paragraph number" data-tip-side="top" className="lens-btn w-8 justify-center text-lens-fg/85 hover:text-lens-fg" onClick={onCopy}>
              <Copy size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Add a note" data-tip="Add a note" data-tip-hint="In your own words" data-tip-side="top" className="lens-btn w-8 justify-center text-lens-fg/85 hover:text-lens-fg" onClick={() => setMode("note")}>
              <PenLine size={15} aria-hidden="true" />
            </button>
            </div>
          </div>
        )}
        {mode !== "bar" && (
          <form
            className="lens-morph w-[min(420px,calc(100vw-24px))]"
            onSubmit={(e) => {
              e.preventDefault();
              const t = text.trim();
              if (!t) return;
              if (mode === "ask") onAction("ask", t);
              else onNote(t);
            }}
          >
            <textarea
              autoFocus
              rows={1}
              value={text}
              maxLength={mode === "note" ? NOTE_MAX_LENGTH : undefined}
              onChange={(e) => {
                setText(mode === "note" ? clampNote(e.target.value) : e.target.value);
                e.target.style.height = "32px";
                e.target.style.height = `${Math.min(168, e.target.scrollHeight)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement).requestSubmit();
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  if (text) setText("");
                  else setMode("bar");
                }
              }}
              placeholder={mode === "ask" ? "Ask about the selection" : "A note, in your own words"}
              aria-label={mode === "ask" ? "Your question about the selected passage" : "Your note on the selected passage"}
              className="block max-h-[168px] min-h-8 w-full resize-none bg-transparent px-3 pt-[7px] font-serif text-[15px] leading-[1.45] text-lens-fg outline-none placeholder:text-lens-mute focus-visible:outline-none"
              style={{ height: 32 }}
            />
            <div className="flex items-center justify-between gap-3 pb-0.5 pl-3 pr-0.5 pt-1">
              <span className="text-[11.5px] text-lens-mute">
                ↵ to {mode === "ask" ? "ask" : "keep"} <span className="opacity-60">·</span> Shift ↵ new line
                {mode === "note" ? (
                  <>
                    {" "}
                    <span className="opacity-60">·</span> <span data-testid="note-counter" className={`tabular-nums ${text.length >= NOTE_MAX_LENGTH - 200 ? "text-[var(--rubric)]" : ""}`}>{text.length}/{NOTE_MAX_LENGTH}</span>
                  </>
                ) : null}
              </span>
              <button type="submit" aria-label={mode === "ask" ? "Ask" : "Keep note"} data-tip={mode === "ask" ? "Ask" : "Keep"} data-tip-kbd="↵" className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-[var(--rubric)] text-white transition-transform active:scale-90 disabled:opacity-40" disabled={!text.trim()}>
                <ArrowUp size={14} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </div>
          </form>
        )}
        {arrow}
      </div>
      <button type="button" className="sr-only" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
