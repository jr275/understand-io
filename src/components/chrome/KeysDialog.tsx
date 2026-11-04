"use client";

import { useEffect, useRef } from "react";
import { useModalFocus } from "@/lib/client/useModalFocus";
import { X } from "lucide-react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";

const ROWS: { keys: string[] | null; text?: boolean; what: MessageKey }[] = [
  { keys: null, text: true, what: "keys.askSelection" },
  { keys: ["/"], what: "keys.askWhole" },
  { keys: ["J", "K"], what: "keys.nextPrev" },
  { keys: ["Enter"], what: "keys.askParagraph" },
  { keys: ["[", "]"], what: "keys.prevNextGloss" },
  { keys: ["B"], what: "keys.glossText" },
  { keys: ["N"], what: "keys.notebook" },
  { keys: ["I"], what: "keys.understand" },
  { keys: ["F"], what: "keys.focusMode" },
  { keys: ["S"], what: "keys.find" },
  { keys: ["L"], what: "keys.listen" },
  { keys: ["Space"], what: "keys.pause" },
  { keys: ["V"], what: "keys.voice" },
  { keys: ["⇧", "U"], what: "keys.underline" },
  { keys: ["⇧", "H"], what: "keys.highlight" },
  { keys: ["Esc"], what: "keys.escape" },
  { keys: ["?"], what: "keys.thisList" },
];

export function KeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <div className="absolute inset-0 bg-[color-mix(in_oklab,var(--bg)_60%,transparent)] backdrop-blur-[3px]" style={{ animation: "fade .25s var(--ease-out)" }} onPointerDown={onClose} />
      <div ref={dialogRef} role="dialog" aria-label={t("keys.dialog")} aria-modal="true" className="pop relative w-full max-w-[420px] p-6" style={{ ["--origin" as string]: "center" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-[22px] leading-none text-ink">{t("keys.title")}</h2>
          <button type="button" aria-label={t("common.close")} data-tip={t("common.close")} data-tip-kbd="Esc" className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunk" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <dl className="divide-y divide-rule">
          {ROWS.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="flex gap-1">
                {r.keys ? r.keys.map((k) => <kbd key={k}>{k}</kbd>) : <span className="text-[13px] text-ink-2">{t("keys.selectThenType")}</span>}
              </dt>
              <dd className="text-right text-[13px] text-ink-3">{t(r.what)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
