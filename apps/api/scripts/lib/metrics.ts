export type BinaryObservation = {
  expected: boolean;
  predicted: boolean;
};

export type BinaryMetrics = {
  true_positive: number;
  false_positive: number;
  true_negative: number;
  false_negative: number;
  total: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  false_positive_rate: number;
};

export type ThresholdMetrics = BinaryMetrics & {
  threshold: number;
};

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function computeBinaryMetrics(rows: BinaryObservation[]): BinaryMetrics {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (const row of rows) {
    if (row.expected && row.predicted) truePositive += 1;
    else if (!row.expected && row.predicted) falsePositive += 1;
    else if (!row.expected && !row.predicted) trueNegative += 1;
    else falseNegative += 1;
  }

  const total = rows.length;
  const precision = safeDivide(truePositive, truePositive + falsePositive);
  const recall = safeDivide(truePositive, truePositive + falseNegative);

  return {
    true_positive: truePositive,
    false_positive: falsePositive,
    true_negative: trueNegative,
    false_negative: falseNegative,
    total,
    precision,
    recall,
    f1: safeDivide(2 * precision * recall, precision + recall),
    accuracy: safeDivide(truePositive + trueNegative, total),
    false_positive_rate: safeDivide(falsePositive, falsePositive + trueNegative),
  };
}

export function selectBestThreshold(rows: ThresholdMetrics[]): ThresholdMetrics {
  if (rows.length === 0) throw new Error("Expected at least one threshold result");

  return [...rows].sort(
    (left, right) =>
      right.f1 - left.f1 ||
      right.precision - left.precision ||
      right.threshold - left.threshold
  )[0];
}
