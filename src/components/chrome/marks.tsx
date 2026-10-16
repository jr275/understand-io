/** The Gloss mark: three text lines, a faint rule and a rubric dot. */
export function GlossMark({ className = "size-[21px] shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M3 6.5h10.5M3 11.5h10.5M3 16.5h6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18.5 3v18" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.32" />
      <circle cx="18.5" cy="11.5" r="2.9" fill="var(--rubric)" />
    </svg>
  );
}

/** Partner credit shown beside the wordmark: a three-disc mark plus "together.ai". */
export function PartnerMark() {
  return (
    <span className="flex items-center gap-1.5" aria-label="Together AI">
      <svg viewBox="0 0 39 36" className="h-[19px] w-auto" aria-hidden="true">
        <circle cx="27" cy="10" r="9.5" fill="#EF2CC1" />
        <circle cx="10" cy="10" r="9.5" fill="#CAAEF5" />
        <circle cx="19" cy="26" r="9.5" fill="#FC4C02" />
      </svg>
      <span className="hidden text-[15px] font-medium tracking-[-0.01em] min-[860px]:inline">together.ai</span>
    </span>
  );
}
