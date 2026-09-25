type SignalMarkProps = {
  // Mark only, no wordmark — for places that set their own label.
  compact?: boolean;
  // Wordmark colour follows the surface: ink on light, white on midnight.
  tone?: "light" | "dark";
};

// The mark is a signal trace with one point picked out at its peak: the moment
// the line does something worth noticing. The tile runs from Signal blue to
// midnight, and the peak is the brand's single warm colour — flare, the
// complement of the blue — so the eye lands on it even at favicon size.
// The gradient lives in CSS, not an SVG <defs>, so repeated or hidden
// instances can never lose their fill to a duplicate id.
export function SignalMark({ compact = false, tone = "light" }: SignalMarkProps) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 ${tone === "dark" ? "text-white" : "text-ink"}`}
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(135deg,#2b61cc_0%,#0f2150_58%,#061436_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${
          compact ? "h-7 w-7" : "h-9 w-9"
        }`}
      >
        <svg viewBox="0 0 36 36" fill="none" className="h-full w-full">
          <path
            d="M8 21h4.4l2.4-7.2 4.2 13.2 2.9-9.4"
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="26.6" cy="17.6" r="5.2" fill="#f96e31" opacity="0.28" />
          <circle cx="26.6" cy="17.6" r="3" fill="#f96e31" />
        </svg>
      </span>
      {!compact && (
        <span className="font-display text-[1.15rem] font-semibold tracking-[-0.03em]">Signal</span>
      )}
    </span>
  );
}
