"use client";

import { X } from "lucide-react";
import { dismissToast, useToasts } from "@/lib/store/toast";
import { useT } from "@/i18n/client";

export function Toasts({ bottom = 84 }: { bottom?: number }) {
  const tr = useT();
  const toasts = useToasts();
  if (!toasts.length) return null;
  const t = toasts[toasts.length - 1];
  return (
    <div
      role="status"
      className="fixed left-1/2 z-[55] flex w-max max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-[18px] bg-lens py-1.5 pl-4 pr-1.5 text-[13px] leading-snug text-lens-fg shadow-pop sm:rounded-full"
      style={{ bottom: `calc(env(safe-area-inset-bottom) + ${bottom}px)`, animation: "rise 0.45s var(--ease-spring) both" }}
    >
      <span>{t.text}</span>
      {t.action ? (
        <button type="button" className="font-medium underline decoration-lens-mute underline-offset-4" onClick={t.action.onClick}>
          {t.action.label}
        </button>
      ) : null}
      <button type="button" aria-label={tr("common.dismiss")} className="grid size-7 place-items-center rounded-full text-lens-mute hover:bg-lens-hover hover:text-lens-fg" onClick={() => dismissToast(t.id)}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
