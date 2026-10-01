// Sig — Signal's assistant, drawn as a small sun-yellow robot face.
//
// Moods map to what the assistant is actually doing, so the face is information,
// not decoration: `thinking` while a request streams, `unsure` when it declines
// for thin evidence, `happy` on a settled hit or a finished setup. Animation is
// pure CSS (globals.css) and stops under prefers-reduced-motion.

export type SigMood = "idle" | "thinking" | "happy" | "unsure";

const EYE = "#fff7d6";
const INK = "var(--color-ink, #0f1d2b)";

export function Sig({
  mood = "idle",
  size = 40,
  title = "Sig, Signal's assistant",
  decorative = false,
  className,
}: {
  mood?: SigMood;
  size?: number;
  title?: string;
  decorative?: boolean;
  className?: string;
}) {
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": title };

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      data-mood={mood}
      className={className}
      {...a11y}
    >
      <g className="sig-wave" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round">
        <path d="M29 1.8a6 6 0 0 1 0 5.6" />
        <path d="M19 1.8a6 6 0 0 0 0 5.6" />
      </g>
      <line x1="24" y1="11" x2="24" y2="5.5" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="24" cy="4.6" r="2.4" fill={INK} />

      <rect x="2.6" y="21" width="4" height="10" rx="2" fill={INK} />
      <rect x="41.4" y="21" width="4" height="10" rx="2" fill={INK} />
      <rect
        x="5.5"
        y="11"
        width="37"
        height="31"
        rx="12"
        fill="var(--color-sun, #ffd23f)"
        stroke={INK}
        strokeWidth="2.2"
      />
      <rect x="10.5" y="16.5" width="27" height="15" rx="7.5" fill={INK} />

      <g className="sig-eyes">
        {mood === "happy" ? (
          <g fill="none" stroke={EYE} strokeWidth="2.2" strokeLinecap="round">
            <path d="M16.6 25.6q2.4-3.4 4.8 0" />
            <path d="M26.6 25.6q2.4-3.4 4.8 0" />
          </g>
        ) : mood === "unsure" ? (
          <>
            <ellipse cx="19" cy="24" rx="2.5" ry="3.1" fill={EYE} />
            <path d="M26.6 24.6h4.8" stroke={EYE} strokeWidth="2.2" strokeLinecap="round" />
          </>
        ) : (
          <>
            <ellipse cx="19" cy="24" rx="2.5" ry="3.1" fill={EYE} />
            <ellipse cx="29" cy="24" rx="2.5" ry="3.1" fill={EYE} />
          </>
        )}
      </g>

      <circle cx="11.5" cy="36" r="1.9" fill="#f59e3b" opacity="0.45" />
      <circle cx="36.5" cy="36" r="1.9" fill="#f59e3b" opacity="0.45" />
      {mood === "unsure" ? (
        <path d="M21 37h6" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path
          d={mood === "happy" ? "M20.2 35.6q3.8 3.4 7.6 0" : "M21.2 36.2q2.8 2 5.6 0"}
          fill="none"
          stroke={INK}
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
