"use client";

import { useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { useModalFocus } from "@/lib/client/useModalFocus";
import { useT } from "@/i18n/client";
import { localizeServerMessage as lm } from "@/i18n/serverMessages";

/**
 * `onRead` resolves true when the text was saved (the parent then closes the dialog); on false the dialog stays open with
 * `error` shown and the typed text intact, so a failed import never costs the reader what they pasted.
 */
export function PasteDialog({
  initial = "",
  busy = false,
  error = null,
  onClose,
  onRead,
}: {
  initial?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onRead: (text: string) => void | Promise<unknown>;
}) {
  const t = useT();
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
        aria-label={t("landing.pasteTitle")}
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
              <p className="font-serif text-[19px] leading-tight text-ink">{t("landing.pasteTitle")}</p>
              <p className="mt-1 text-[13px] text-ink-3">{t("landing.pasteHelp")}</p>
            </div>
            <button type="button" aria-label={t("common.close")} className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-sunk hover:text-ink" onClick={onClose}>
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          {error ? (
            <p role="alert" className="mt-3 rounded-[10px] bg-rubric-wash px-3 py-2 text-[13px] text-rubric-text">
              {lm(error)}
            </p>
          ) : null}
          <textarea data-autofocus value={pasted} onChange={(e) => setPasted(e.target.value)} rows={9} placeholder={t("landing.pastePlaceholder")} aria-label={t("landing.pasteLabel")} className="add-text font-serif text-[15px]" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-ink-4">{pasted.trim() ? t("landing.words", { n: pasted.trim().split(/\s+/).length }) : ""}</span>
            <button type="submit" disabled={!pasted.trim() || busy} className="add-btn">
              {t("common.read")} <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
