"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

const ROWS: { keys: string[] | null; text: string; what: string }[] = [
  { keys: null, text: "Select text, then type", what: "Ask about the selection" },
  { keys: ["/"], text: "", what: "Ask about the whole text" },
  { keys: ["J", "K"], text: "", what: "Next and previous paragraph" },
  { keys: ["Enter"], text: "", what: "Ask about the current paragraph" },
  { keys: ["[", "]"], text: "", what: "Previous and next gloss" },
  { keys: ["B"], text: "", what: "Gloss this text" },
  { keys: ["N"], text: "", what: "Notebook" },
  { keys: ["F"], text: "", what: "Focus mode" },
  { keys: ["L"], text: "", what: "Listen: read aloud from here" },
  { keys: ["Space"], text: "", what: "Pause or resume reading aloud" },
  { keys: ["V"], text: "", what: "Ask by voice where something is" },
  { keys: ["U"], text: "", what: "Underline the selection" },
  { keys: ["H"], text: "", what: "Highlight the selection" },
  { keys: ["Esc"], text: "", what: "Close or step back" },
  { keys: ["?"], text: "", what: "This list" },
];

export function KeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    <div className="fixed inset-0 z-[80] grid place-items-center p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-[color-mix(in_oklab,var(--bg)_60%,transparent)] backdrop-blur-[3px]" style={{ animation: "fade .25s var(--ease-out)" }} />
      <div role="dialog" aria-label="Keyboard shortcuts" aria-modal="true" className="pop relative w-full max-w-[420px] p-6" style={{ ["--origin" as string]: "center" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-[22px] leading-none text-ink">Keys</h2>
          <button type="button" aria-label="Close" data-tip="Close" data-tip-kbd="Esc" className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunk" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <dl className="divide-y divide-rule">
          {ROWS.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="flex gap-1">
                {r.keys ? r.keys.map((k) => <kbd key={k}>{k}</kbd>) : <span className="text-[13px] text-ink-2">{r.text}</span>}
              </dt>
              <dd className="text-right text-[13px] text-ink-3">{r.what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
