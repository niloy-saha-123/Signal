// Brier scoring and calibration buckets — how Signal grades itself.
//
// A Brier score is the mean squared error of a probabilistic forecast:
// (probability - outcome)^2, averaged over resolved predictions. Lower is
// better, 0 is perfect, and crucially it is a *proper* scoring rule — it is
// minimised by stating your true belief. Overclaiming confidence costs you when
// you are wrong, and hedging everything to 50% costs you when you are right, so
// there is no way to game it except by being better calibrated.
//
// That property is why the whole product hangs off this function rather than an
// accuracy percentage. "We were right 70% of the time" says nothing without
// knowing how confident those calls were; a system that says 51% on everything
// and gets 70% right is badly calibrated and useless for making decisions.
//
// Two rules keep the number honest:
//
//   - Only `hit` and `miss` are scored. `unresolved` (the window closed with no
//     evidence) and `void` (a human marked it moot) carry no information about
//     accuracy, and folding them in either direction would let the score be
//     moved by things that are not forecasts.
//   - An empty track record scores `null`, never 0. Zero is a perfect Brier
//     score, and rendering "no predictions yet" as perfection is the single most
//     dishonest thing this file could do.

// What you score by saying "maybe" to everything: (0.5 - outcome)^2 = 0.25.
// Published alongside every score because a Brier number alone means nothing to
// a reader — this is the bar worth beating.
export const BASELINE_BRIER = 0.25;

// Width of each calibration bucket. Ten buckets across [0, 1] is the standard
// resolution for a reliability diagram: fine enough to show a curve, coarse
// enough that each bucket holds real counts before the ledger is large.
const BUCKET_WIDTH = 0.1;
const BUCKET_COUNT = 10;

export function brierScore(probability: number, hit: boolean): number {
  const outcome = hit ? 1 : 0;
  return (probability - outcome) ** 2;
}

export interface CalibrationBucket {
  // Human-readable range, e.g. "70-80%".
  range: string;
  // Mean probability the system actually stated inside this bucket.
  predicted: number;
  // Fraction of those that turned out to be hits.
  observed: number;
  count: number;
}

export interface Calibration {
  resolved_count: number;
  // null when nothing has resolved yet. Never 0 — see the file header.
  brier: number | null;
  baseline_brier: number;
  buckets: CalibrationBucket[];
}

export interface ResolvedPrediction {
  probability: number;
  status: "hit" | "miss";
}

function bucketIndexFor(probability: number): number {
  // A probability of exactly 1 would land in a non-existent 11th bucket. The
  // schema clamps to 0.95 so this cannot happen today, but the ledger is meant
  // to outlive that constant.
  return Math.min(BUCKET_COUNT - 1, Math.floor(probability / BUCKET_WIDTH));
}

function rangeLabel(index: number): string {
  const low = Math.round(index * BUCKET_WIDTH * 100);
  const high = Math.round((index + 1) * BUCKET_WIDTH * 100);
  return `${low}-${high}%`;
}

export function computeCalibration(resolved: ResolvedPrediction[]): Calibration {
  if (resolved.length === 0) {
    return {
      resolved_count: 0,
      brier: null,
      baseline_brier: BASELINE_BRIER,
      buckets: [],
    };
  }

  const total = resolved.reduce(
    (sum, prediction) => sum + brierScore(prediction.probability, prediction.status === "hit"),
    0
  );

  const grouped = new Map<number, ResolvedPrediction[]>();
  for (const prediction of resolved) {
    const index = bucketIndexFor(prediction.probability);
    const bucket = grouped.get(index);
    if (bucket) bucket.push(prediction);
    else grouped.set(index, [prediction]);
  }

  // Only buckets that actually hold predictions. An empty bucket emitted with
  // observed: 0 would draw a reliability curve diving to the floor in ranges the
  // system never made a call in — a visual claim of being badly wrong where it
  // simply stayed quiet.
  const buckets = [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, entries]) => ({
      range: rangeLabel(index),
      predicted:
        entries.reduce((sum, entry) => sum + entry.probability, 0) / entries.length,
      observed: entries.filter((entry) => entry.status === "hit").length / entries.length,
      count: entries.length,
    }));

  return {
    resolved_count: resolved.length,
    brier: total / resolved.length,
    baseline_brier: BASELINE_BRIER,
    buckets,
  };
}
