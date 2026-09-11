import { describe, expect, it } from "vitest";
import {
  computeBinaryMetrics,
  selectBestThreshold,
  type ThresholdMetrics,
} from "../../../scripts/lib/metrics";

describe("computeBinaryMetrics", () => {
  it("returns the exact confusion matrix and derived metrics", () => {
    expect(
      computeBinaryMetrics([
        { expected: true, predicted: true },
        { expected: true, predicted: false },
        { expected: false, predicted: true },
        { expected: false, predicted: false },
        { expected: true, predicted: true },
      ])
    ).toEqual({
      true_positive: 2,
      false_positive: 1,
      true_negative: 1,
      false_negative: 1,
      total: 5,
      precision: 2 / 3,
      recall: 2 / 3,
      f1: 2 / 3,
      accuracy: 3 / 5,
      false_positive_rate: 1 / 2,
    });
  });

  it("uses zero for every undefined denominator", () => {
    expect(computeBinaryMetrics([])).toEqual({
      true_positive: 0,
      false_positive: 0,
      true_negative: 0,
      false_negative: 0,
      total: 0,
      precision: 0,
      recall: 0,
      f1: 0,
      accuracy: 0,
      false_positive_rate: 0,
    });
  });
});

describe("selectBestThreshold", () => {
  const base: ThresholdMetrics = {
    threshold: 0.85,
    true_positive: 1,
    false_positive: 0,
    true_negative: 1,
    false_negative: 0,
    total: 2,
    precision: 1,
    recall: 1,
    f1: 1,
    accuracy: 1,
    false_positive_rate: 0,
  };

  it("maximizes F1, then precision, then the stricter threshold", () => {
    const selected = selectBestThreshold([
      { ...base, threshold: 0.85, f1: 0.84, precision: 0.84 },
      { ...base, threshold: 0.88, f1: 0.84, precision: 0.89 },
      { ...base, threshold: 0.9, f1: 0.84, precision: 0.89 },
      { ...base, threshold: 0.91, f1: 0.81, precision: 0.94 },
    ]);

    expect(selected.threshold).toBe(0.9);
  });

  it("rejects an empty result set", () => {
    expect(() => selectBestThreshold([])).toThrow("at least one threshold");
  });
});
