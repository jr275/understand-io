"use client";

import type { ReactNode } from "react";

interface Option<T extends string> {
  value: T;
  label: ReactNode;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  className?: string;
}

/** Pill segmented control (`role=radiogroup`) as used in the Appearance panel. */
export function Segmented<T extends string>({ label, value, options, onChange, className = "" }: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`grid rounded-[10px] bg-sunk p-[3px] ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] font-medium transition-colors ${
              on ? "bg-pill text-ink shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-ink-3 hover:text-ink"
            }`}
          >
            <span className="inline-flex translate-y-px items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
