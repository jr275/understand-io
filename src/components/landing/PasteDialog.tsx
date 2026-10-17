"use client";

import { useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { useModalFocus } from "@/lib/client/useModalFocus";

export function PasteDialog({ initial = "", busy = false, onClose, onRead }: { initial?: string; busy?: boolean; onClose: () => void; onRead: (text: string) => void }) {
  const [pasted, setPasted] = useState(initial);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4">
      <div className="absolute inset-0 bg-[color-mix(in_oklab,var(--bg)_60%,transparent)] backdrop-blur-[3px]" onPointerDown={onClose} />
      {/* role=dialog belongs on a div: ARIA does not allow it on <form>. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Paste text"
        className="pop relative w-full max-w-[560px] p-5"
        style={{ ["--origin" as string]: "center" }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pasted.trim().length) onRead(pasted);
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-serif text-[19px] leading-tight text-ink">Paste text</p>
              <p className="mt-1 text-[13px] text-ink-3">A chapter, an essay, notes. Understand.io will set it like an article.</p>
            </div>
            <button type="button" aria-label="Close" className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-sunk hover:text-ink" onClick={onClose}>
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          <textarea data-autofocus value={pasted} onChange={(e) => setPasted(e.target.value)} rows={9} placeholder="Paste anything…" aria-label="Text to read" className="add-text font-serif text-[15px]" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-ink-4">{pasted.trim() ? `${pasted.trim().split(/\s+/).length} words` : ""}</span>
            <button type="submit" disabled={!pasted.trim() || busy} className="add-btn">
              Read <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
