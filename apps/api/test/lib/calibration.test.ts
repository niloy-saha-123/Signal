import { describe, it, expect } from "vitest";
import {
  brierScore,
  computeCalibration,
  BASELINE_BRIER,
} from "@/lib/calibration";

describe("brierScore", () => {
  it("scores a confident hit better than a hedged one", () => {
    expect(brierScore(0.9, true)).toBeLessThan(brierScore(0.6, true));
  });

  it("scores a confident miss worse than a hedged one", () => {
    // Confidence has to cost something when it is wrong, or the system learns
    // that claiming 0.95 on everything is free.
    expect(brierScore(0.9, false)).toBeGreaterThan(brierScore(0.6, false));
  });

  it("gives an even 50% call the same score whichever way it lands", () => {
    expect(brierScore(0.5, true)).toBeCloseTo(brierScore(0.5, false), 10);
    expect(brierScore(0.5, true)).toBeCloseTo(0.25, 10);
  });

  it("computes the squared error of the stated probability", () => {
    expect(brierScore(0.72, true)).toBeCloseTo(0.0784, 10);
    expect(brierScore(0.72, false)).toBeCloseTo(0.5184, 10);
  });
});

describe("computeCalibration", () => {
  it("returns a null score rather than a zero for an empty track record", () => {
    // A zero here would render as a perfect score on the scorecard. "No track
    // record yet" and "flawless" must never be the same value.
    const c = computeCalibration([]);
    expect(c.resolved_count).toBe(0);
    expect(c.brier).toBeNull();
  });

  it("reports the always-50% reference so a score can be read as good or bad", () => {
    // A Brier score alone is meaningless to a reader. 0.25 is what you get by
    // saying "maybe" to everything, and that is the bar worth beating.
    expect(BASELINE_BRIER).toBeCloseTo(0.25, 10);
    expect(computeCalibration([]).baseline_brier).toBeCloseTo(0.25, 10);
  });

  it("averages the Brier score across resolved predictions", () => {
    const c = computeCalibration([
      { probability: 0.9, status: "hit" },
      { probability: 0.9, status: "miss" },
    ]);
    expect(c.resolved_count).toBe(2);
    // (0.01 + 0.81) / 2
    expect(c.brier).toBeCloseTo(0.41, 10);
  });

  it("buckets predictions by stated probability and reports the observed rate", () => {
    const c = computeCalibration([
      { probability: 0.72, status: "hit" },
      { probability: 0.75, status: "hit" },
      { probability: 0.71, status: "miss" },
      { probability: 0.78, status: "hit" },
    ]);

    const bucket = c.buckets.find((b) => b.count === 4);
    expect(bucket).toBeDefined();
    // Said ~74% on average, was right 3 of 4 times.
    expect(bucket!.observed).toBeCloseTo(0.75, 10);
    expect(bucket!.predicted).toBeCloseTo(0.74, 2);
  });

  it("reports no buckets for an empty track record", () => {
    expect(computeCalibration([]).buckets).toEqual([]);
  });

  it("omits buckets that hold no predictions", () => {
    // An empty bucket plotted at zero would draw a calibration curve diving to
    // the floor in ranges the system never made a call in.
    const c = computeCalibration([{ probability: 0.72, status: "hit" }]);
    expect(c.buckets.every((b) => b.count > 0)).toBe(true);
    expect(c.buckets).toHaveLength(1);
  });
});

describe("calibration bucketing precision", () => {
  it("files round probabilities in the bucket a human would name", () => {
    // 0.7 / 0.1 is 6.999999999999999 in IEEE-754, so a naive floor puts a 70%
    // call in the 60-70% row. Round probabilities are exactly what a model
    // emits most often, and misfiling them corrupts the one surface whose
    // whole purpose is an honest calibration read.
    for (const [probability, expected] of [
      [0.1, "10-20%"],
      [0.2, "20-30%"],
      [0.3, "30-40%"],
      [0.4, "40-50%"],
      [0.5, "50-60%"],
      [0.6, "60-70%"],
      [0.7, "70-80%"],
      [0.8, "80-90%"],
      [0.9, "90-100%"],
    ] as Array<[number, string]>) {
      const c = computeCalibration([{ probability, status: "hit" }]);
      expect(c.buckets[0].range, `probability ${probability}`).toBe(expected);
    }
  });

  it("keeps a probability at the top of the range inside the last bucket", () => {
    const c = computeCalibration([{ probability: 1, status: "hit" }]);
    expect(c.buckets[0].range).toBe("90-100%");
  });
});
