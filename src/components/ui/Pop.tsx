"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  label: string;
  width?: number;
  children: ReactNode;
  className?: string;
  /** Element that opened the popover; clicks on it are ignored for outside-click closing. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

/** Anchored popover (`.pop`) below a topbar button. Closes on Escape and outside click. */
export function Pop({ open, onClose, label, width = 348, children, className = "", anchorRef }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchorRef?.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, onClose, anchorRef]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`pop absolute right-0 top-[calc(100%+8px)] z-[60] p-4 ${className}`}
      style={{ width, ["--origin" as string]: "top right" }}
    >
      {children}
    </div>
  );
}
