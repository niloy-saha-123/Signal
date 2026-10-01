import { Sig } from "./Sig";

// The wordmark: Sig's face plus the name in the display face. `plain` drops the
// face for tight spots; the favicon is app/icon.svg.
export function Wordmark({ size = 26, plain = false }: { size?: number; plain?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      {plain ? null : <Sig size={size} decorative />}
      <span
        className="font-display font-extrabold tracking-[-0.03em] text-ink"
        style={{ fontSize: Math.round(size * 0.78) }}
      >
        signal
      </span>
    </span>
  );
}
