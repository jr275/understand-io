/** The Keeple mark: three text lines, a faint rule and a rubric dot. */
export function GlossMark({ className = "size-[21px] shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M3 6.5h10.5M3 11.5h10.5M3 16.5h6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18.5 3v18" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.32" />
      <circle cx="18.5" cy="11.5" r="2.9" fill="var(--rubric)" />
    </svg>
  );
}
