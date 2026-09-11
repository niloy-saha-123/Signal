import { describe, expect, it, vi } from "vitest";
import {
  calibrateDeduplication,
  parseCalibrationDataset,
  runDedupCalibration,
  type DedupCalibrationDeps,
} from "../../scripts/dedup-calibration";

const pairA = {
  id: "11111111-1111-4111-8111-111111111111",
  left_signal_id: "22222222-2222-4222-8222-222222222222",
  right_signal_id: "33333333-3333-4333-8333-333333333333",
  similarity: 0.9,
  same_event: true,
};
const pairB = {
  id: "44444444-4444-4444-8444-444444444444",
  left_signal_id: "55555555-5555-4555-8555-555555555555",
  right_signal_id: "66666666-6666-4666-8666-666666666666",
  similarity: 0.87,
  same_event: false,
};
const dataset = JSON.stringify({ schema_version: 1, pairs: [pairA, pairB] });

describe("parseCalibrationDataset", () => {
  it("rejects empty, duplicate, and malformed human-labeled pairs", () => {
    expect(() => parseCalibrationDataset(JSON.stringify({ schema_version: 1, pairs: [] }))).toThrow(
      "at least 1"
    );
    expect(() =>
      parseCalibrationDataset(JSON.stringify({ schema_version: 1, pairs: [pairA, pairA] }))
    ).toThrow("Duplicate pair id");
    expect(() =>
      parseCalibrationDataset(
        JSON.stringify({
          schema_version: 1,
          pairs: [
            pairA,
            {
              ...pairB,
              left_signal_id: pairA.right_signal_id,
              right_signal_id: pairA.left_signal_id,
            },
          ],
        })
      )
    ).toThrow("Duplicate signal pair");
    expect(() =>
      parseCalibrationDataset(JSON.stringify({ schema_version: 1, pairs: [{ ...pairA, similarity: 2 }] }))
    ).toThrow();
    expect(() => parseCalibrationDataset("not-json")).toThrow("valid JSON");
  });
});

describe("calibrateDeduplication", () => {
  it("computes exact threshold confusion matrices and picks highest F1", () => {
    const report = calibrateDeduplication(parseCalibrationDataset(dataset), [0.85, 0.88, 0.91]);

    expect(report.thresholds).toEqual([
      expect.objectContaining({ threshold: 0.85, true_positive: 1, false_positive: 1, f1: 2 / 3 }),
      expect.objectContaining({ threshold: 0.88, true_positive: 1, false_positive: 0, f1: 1 }),
      expect.objectContaining({ threshold: 0.91, true_positive: 0, false_positive: 0, f1: 0 }),
    ]);
    expect(report.selected_threshold).toBe(0.88);
    expect(report.production_threshold).toBe(0.88);
    expect(report.production_threshold_changed).toBe(false);
  });
});

describe("runDedupCalibration", () => {
  function dependencies(content = dataset): DedupCalibrationDeps {
    return {
      readFile: vi.fn(async () => content),
      digest: vi.fn(() => "fixture-sha256"),
    };
  }

  it("loads an explicit fixture and validates unique thresholds", async () => {
    const deps = dependencies();
    const report = await runDedupCalibration(
      ["--file=/fixtures/pairs.json", "--thresholds=0.91,0.88,0.85"],
      deps
    );

    expect(deps.readFile).toHaveBeenCalledWith("/fixtures/pairs.json");
    expect(report.fixture_sha256).toBe("fixture-sha256");
    expect(report.thresholds.map((row) => row.threshold)).toEqual([0.85, 0.88, 0.91]);
  });

  it.each([
    [[], "Required"],
    [["--file=x", "--thresholds="], "empty"],
    [["--file=x", "--thresholds=0.88,0.88"], "Duplicate threshold"],
    [["--file=x", "--thresholds=0,0.88"], "between 0 and 1"],
  ])("rejects invalid CLI options %#", async (argv, message) => {
    await expect(runDedupCalibration(argv, dependencies())).rejects.toThrow(message);
  });

  it("propagates fixture read failures", async () => {
    const deps = dependencies();
    deps.readFile = vi.fn(async () => {
      throw new Error("fixture unavailable");
    });
    await expect(runDedupCalibration(["--file=missing.json"], deps)).rejects.toThrow(
      "fixture unavailable"
    );
  });
});
