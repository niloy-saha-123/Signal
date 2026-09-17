type SignalMarkProps = {
  compact?: boolean;
};

export function SignalMark({ compact = false }: SignalMarkProps) {
  return (
    <span className="inline-flex items-center gap-2.5 text-studio-ink">
      <svg
        aria-hidden="true"
        className={compact ? "h-8 w-8" : "h-9 w-9"}
        viewBox="0 0 36 36"
        fill="none"
      >
        <rect width="36" height="36" rx="11" fill="currentColor" />
        <path
          d="M9 20.5h4.2l2.35-7 4.1 13 2.8-9h4.55"
          stroke="white"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="27" cy="17.5" r="2" fill="#87C9F5" />
      </svg>
      {!compact && (
        <span className="font-display text-[1.05rem] font-bold tracking-[-0.035em]">
          Signal
        </span>
      )}
    </span>
  );
}
