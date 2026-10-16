"use client";

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${checked ? "bg-[var(--rubric)]" : "bg-rule-strong"}`}
    >
      <span
        className={`absolute left-[3px] top-[3px] size-4 rounded-full bg-raised shadow transition-transform duration-200 ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

/** Bordered switch button (Numbers / Map / Focus / Listen). */
export function SwitchButton({
  checked,
  onChange,
  children,
  tip,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  tip?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-tip={tip}
      onClick={() => onChange(!checked)}
      className={`flex h-9 items-center justify-center gap-1.5 rounded-[10px] border text-[12.5px] font-medium transition-colors ${
        checked ? "border-transparent bg-rubric-wash text-rubric-text" : "border-rule text-ink-3 hover:border-rule-strong hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
