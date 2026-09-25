// The public site's one saturated colour moment: the line from the product
// mark — flat, a sharp movement, flat again — drawn as a bundle of gradient
// strokes. It is the brand's own gesture rather than a borrowed gradient blob:
// the idea of a quiet signal that suddenly does something worth noticing.
//
// Purely decorative, so it is hidden from assistive technology. The strokes
// draw in once on load; reduced-motion users get the finished drawing.

const WIDTH = 1200;
const HEIGHT = 420;
const LINES = 16;

// A damped oscillation centred on `x0`: near-flat at the edges, one decisive
// movement in the middle. Sampled finely and joined with straight segments —
// at this density the joins are invisible and the path stays trivially simple.
function tracePoints(index: number): Array<[number, number]> {
  const spread = index / (LINES - 1);
  const base = 150 + spread * 170;
  const amplitude = 34 + (1 - Math.abs(spread - 0.35) * 1.4) * 70;
  const x0 = 640 - spread * 60;
  const width = 150 + spread * 40;
  const period = 42 + spread * 10;

  const points: Array<[number, number]> = [];
  for (let x = 0; x <= WIDTH; x += 8) {
    const envelope = Math.exp(-(((x - x0) / width) ** 2));
    points.push([x, base - amplitude * envelope * Math.sin((x - x0) / period + 0.9)]);
  }
  return points;
}

function toPath(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y.toFixed(1)}`).join(" ");
}

// The emphasised line, and the exact peak the accent dot marks — derived from
// the same function rather than hand-placed, so the dot always sits on the line.
const HERO_LINE = 3;
const LINE_POINTS = Array.from({ length: LINES }, (_, i) => tracePoints(i));
const PATHS = LINE_POINTS.map(toPath);
const [PEAK_X, PEAK_Y] = LINE_POINTS[HERO_LINE].reduce((best, point) =>
  point[1] < best[1] ? point : best
);

// `id` keeps gradient references unique when the trace appears more than once
// on a page; `tone="dark"` swaps the strokes for use on midnight surfaces.
export function SignalTrace({
  className,
  id = "trace",
  tone = "light",
}: {
  className?: string;
  id?: string;
  tone?: "light" | "dark";
}) {
  const stroke = `${id}-stroke`;
  const glow = `${id}-glow`;
  const dark = tone === "dark";
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={stroke} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={dark ? "#ffffff" : "var(--color-trace-a)"} stopOpacity="0.1" />
          <stop offset="0.35" stopColor={dark ? "#9fbaf5" : "var(--color-trace-a)"} />
          <stop offset="0.62" stopColor={dark ? "#6f93e6" : "var(--color-trace-b)"} />
          <stop offset="0.82" stopColor={dark ? "#b9cdf3" : "var(--color-trace-c)"} />
          <stop offset="1" stopColor="var(--color-trace-d)" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id={glow}>
          <stop offset="0" stopColor="var(--color-flare)" stopOpacity={dark ? 0.55 : 0.4} />
          <stop offset="1" stopColor="var(--color-flare)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {PATHS.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={`url(#${stroke})`}
          strokeWidth={i === HERO_LINE ? 2.6 : 1.2}
          strokeOpacity={i === HERO_LINE ? 1 : (dark ? 0.18 : 0.26) + (i % 5) * 0.07}
          strokeLinecap="round"
          className="trace-draw"
          style={{ animationDelay: `${i * 45}ms` }}
        />
      ))}

      {/* The moment the line does something worth noticing — in flare, the
          brand's one warm colour. */}
      <circle cx={PEAK_X} cy={PEAK_Y} r="52" fill={`url(#${glow})`} />
      <circle cx={PEAK_X} cy={PEAK_Y} r="6.5" fill="var(--color-flare)" />
      <circle cx={PEAK_X} cy={PEAK_Y} r="12" fill="none" stroke="var(--color-flare)" strokeOpacity="0.45" />
    </svg>
  );
}
