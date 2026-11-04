"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ListTree, MessageCircleQuestion, X } from "lucide-react";
import type { Section } from "@/lib/search/find";
import { useT } from "@/i18n/client";

interface Props {
  query: string;
  onQuery: (q: string) => void;
  total: number;
  /** Zero-based index of the current match. */
  current: number;
  truncated: boolean;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  sections: Section[];
  onSection: (s: Section) => void;
  /** Hand the question to the meaning search. */
  onAskMeaning: () => void;
}

/** Find in the open text: the words as typed. Searching by meaning is a different tool and is offered next to it, not mixed in. */
export function FindBar(p: Props) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const typed = p.query.trim().length >= 2;
  const status = !typed ? "" : p.total === 0 ? t("find.noMatches") : t("find.counter", { current: p.current + 1, total: p.total, plus: p.truncated ? "+" : "" });
  return (
    <div role="search" aria-label={t("find.label")} className="fixed right-3 top-[calc(var(--topbar-h)+8px)] z-[44] w-[min(440px,calc(100vw-24px))] rounded-[14px] border border-rule bg-raised p-2 shadow-pop" style={{ animation: "sheet-in 0.25s var(--ease-out)" }}>
      <div className="flex items-center gap-1">
        <input
          ref={input}
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) p.onPrev();
              else p.onNext();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              p.onClose();
            }
          }}
          type="search"
          aria-label={t("find.label")}
          placeholder={t("find.placeholder")}
          className="h-9 min-w-0 flex-1 rounded-[9px] bg-sunk px-3 text-[14px] text-ink outline-none placeholder:text-ink-4 focus-visible:ring-2 focus-visible:ring-[var(--rubric)]"
          data-field
        />
        <span role="status" aria-live="polite" className="min-w-[64px] px-1 text-right text-[12.5px] tabular-nums text-ink-3">
          {status}
        </span>
        <button type="button" aria-label={t("find.previous")} data-tip={t("find.previousTip")} data-tip-kbd="⇧↵" disabled={p.total === 0} className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-sunk hover:text-ink disabled:pointer-events-none disabled:opacity-35" onClick={p.onPrev}>
          <ChevronUp size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label={t("find.next")} data-tip={t("find.nextTip")} data-tip-kbd="↵" disabled={p.total === 0} className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-sunk hover:text-ink disabled:pointer-events-none disabled:opacity-35" onClick={p.onNext}>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label={t("find.closeSearch")} data-tip={t("common.close")} data-tip-kbd="Esc" className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-sunk hover:text-ink" onClick={p.onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1 px-1 text-[12.5px] text-ink-3">
        <span className="min-w-0 flex-1 leading-snug">{p.truncated ? t("find.truncated") : t("find.exact")}</span>
        {p.sections.length ? (
          <div className="relative">
            <button type="button" aria-expanded={menu} aria-haspopup="menu" className="flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium text-ink-2 hover:bg-sunk hover:text-ink" onClick={() => setMenu((m) => !m)}>
              <ListTree size={14} aria-hidden="true" /> {t("find.sections")}
            </button>
            {menu ? (
              <ul role="menu" aria-label={t("find.sections")} className="scroll-thin absolute right-0 top-[calc(100%+6px)] z-10 max-h-[50vh] w-[320px] max-w-[calc(100vw-40px)] overflow-y-auto rounded-[12px] border border-rule bg-raised p-1 shadow-pop">
                {p.sections.map((s) => (
                  <li key={s.blockId} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className={`flex w-full items-baseline gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13.5px] hover:bg-sunk ${s.level === 3 ? "pl-6 text-ink-2" : "font-medium text-ink"}`}
                      onClick={() => {
                        setMenu(false);
                        p.onSection(s);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      {s.n ? <span className="shrink-0 text-[11px] tabular-nums text-ink-4">¶{s.n}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <button type="button" className="flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium text-ink-2 hover:bg-sunk hover:text-ink" data-tip={t("find.byMeaningTip")} onClick={p.onAskMeaning}>
          <MessageCircleQuestion size={14} aria-hidden="true" /> {t("find.byMeaning")}
        </button>
      </div>
    </div>
  );
}
