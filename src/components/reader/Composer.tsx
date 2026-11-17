"use client";

import { forwardRef, useState } from "react";
import { ArrowUp, Globe, Mic } from "lucide-react";
import { useT } from "@/i18n/client";

interface Props {
  onAsk: (q: string) => void;
  web: boolean;
  onWebToggle: () => void;
  onVoice: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export const Composer = forwardRef<HTMLInputElement, Props>(function Composer({ onAsk, web, onWebToggle, onVoice, disabled, placeholder }, ref) {
  const t = useT();
  const [q, setQ] = useState("");
  return (
    <div className="composer focus-hide pointer-events-none sticky bottom-4 z-30 mt-20 sm:bottom-6">
      <form
        className="pointer-events-auto mx-auto flex max-w-[34rem] items-center gap-2 rounded-[16px] border border-rule bg-raised/92 py-1.5 pl-4 pr-1.5 shadow-pop backdrop-blur-md transition-[border-color,max-width] duration-300 ease-[var(--ease-out)] focus-within:border-rule-strong"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) {
            onAsk(q.trim());
            setQ("");
          }
        }}
      >
        <input
          ref={ref}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? t("composer.placeholder")}
          aria-label={t("composer.label")}
          disabled={disabled}
          className="h-9 min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          onKeyDown={(e) => e.key === "Escape" && (e.currentTarget as HTMLInputElement).blur()}
        />
        <kbd className="hidden sm:inline">/</kbd>
        <button
          type="button"
          aria-label={t("composer.voice")}
          data-tip={t("composer.voiceTip")}
          data-tip-hint={t("composer.voiceHint")}
          data-tip-kbd="V"
          className="grid size-7 shrink-0 place-items-center rounded-[8px] text-ink-3 transition-colors hover:bg-sunk hover:text-ink"
          onClick={onVoice}
        >
          <Mic size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-pressed={web}
          aria-label={t("composer.searchWeb")}
          data-tip={web ? t("composer.webOn") : t("composer.webOff")}
          data-tip-hint={t("composer.webHint")}
          className={`flex h-7 shrink-0 items-center gap-1 rounded-[8px] px-2 text-[11.5px] font-medium transition-colors ${web ? "bg-pill text-ink shadow-[0_1px_2px_rgb(0_0_0/0.1)] ring-1 ring-rule" : "text-ink-3 hover:text-ink"}`}
          onClick={onWebToggle}
        >
          <Globe size={13} aria-hidden="true" />
          {t("composer.web")}
        </button>
        <button type="submit" disabled={!q.trim() || disabled} aria-label={t("composer.ask")} data-tip={t("composer.ask")} data-tip-kbd="↵" className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-ink text-bg transition-opacity disabled:opacity-25">
          <ArrowUp size={17} strokeWidth={2.3} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
});
