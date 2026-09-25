type SignalMarkProps = {
  // Mark only, no wordmark — for places that set their own label.
  compact?: boolean;
};

// The mark is a signal trace with a single point picked out on it: the moment
// the line does something worth noticing. The accent dot is the only colour,
// which is the same rule the rest of the interface follows.
export function SignalMark({ compact = false }: SignalMarkProps) {
  return (
    <span className="inline-flex items-center gap-2.5 text-ink">
      <svg
        aria-hidden="true"
        className={compact ? "h-7 w-7" : "h-9 w-9"}
        viewBox="0 0 36 36"
        fill="none"
      >
        <rect width="36" height="36" rx="10" fill="currentColor" />
        <path
          d="M9 20.5h4.2l2.35-7 4.1 13 2.8-9h4.55"
          stroke="var(--color-ground, #faf9f7)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="27" cy="17.5" r="2" fill="var(--color-accent, #0f6e68)" />
      </svg>
      {!compact && (
        <span className="text-[1.05rem] font-semibold tracking-[-0.025em]">Signal</span>
      )}
    </span>
  );
}
