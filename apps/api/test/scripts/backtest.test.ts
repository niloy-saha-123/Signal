import { describe, expect, it, vi } from "vitest";
import {
  buildBacktestReport,
  parseBacktestDataset,
  runBacktest,
  type BacktestDeps,
  type BacktestPrediction,
} from "../../scripts/backtest";

const positiveCase = {
  id: "11111111-1111-4111-8111-111111111111",
  competitor_id: "22222222-2222-4222-8222-222222222222",
  title: "Documented pricing launch",
  observation_cutoff: "2026-08-01T00:00:00.000Z",
  outcome_at: "2026-08-11T00:00:00.000Z",
  expected_event: true,
  evidence: [
    {
      source_url: "https://example.com/evidence-1",
      observed_at: "2026-07-31T00:00:00.000Z",
      text: "Public evidence available before the cutoff",
    },
  ],
  prediction: {
    predicted_event: true,
    confidence: 0.8,
    evidence_urls: ["https://example.com/evidence-1"],
    provenance: "captured-run-1",
  },
};
const controlCase = {
  ...positiveCase,
  id: "33333333-3333-4333-8333-333333333333",
  title: "Control competitor",
  outcome_at: null,
  expected_event: false,
  prediction: {
    predicted_event: true,
    confidence: 0.65,
    evidence_urls: ["https://example.com/evidence-1"],
    provenance: "captured-run-2",
  },
};
const datasetText = JSON.stringify({ schema_version: 1, cases: [positiveCase, controlCase] });

describe("parseBacktestDataset", () => {
  it("accepts cited cases and rejects empty or unverifiable inputs", () => {
    expect(parseBacktestDataset(datasetText).cases).toHaveLength(2);
    expect(() => parseBacktestDataset(JSON.stringify({ schema_version: 1, cases: [] }))).toThrow(
      "at least 1"
    );
    expect(() =>
      parseBacktestDataset(
        JSON.stringify({
          schema_version: 1,
          cases: [{ ...positiveCase, outcome_at: null }],
        })
      )
    ).toThrow("Positive cases require outcome_at");
    expect(() =>
      parseBacktestDataset(
        JSON.stringify({
          schema_version: 1,
          cases: [
            {
              ...positiveCase,
              prediction: {
                ...positiveCase.prediction,
                evidence_urls: ["https://attacker.example/unsupported"],
              },
            },
          ],
        })
      )
    ).toThrow("uncited evidence URL");
    expect(() =>
      parseBacktestDataset(
        JSON.stringify({
          schema_version: 1,
          cases: [
            {
              ...positiveCase,
              observation_cutoff: "2026-08-12T00:00:00.000Z",
            },
          ],
        })
      )
    ).toThrow("before outcome_at");
    expect(() =>
      parseBacktestDataset(
        JSON.stringify({ schema_version: 1, cases: [positiveCase, positiveCase] })
      )
    ).toThrow("Duplicate backtest case id");
    expect(() => parseBacktestDataset("not-json")).toThrow("valid JSON");
  });
});

describe("buildBacktestReport", () => {
  it("reports audit identity, lead time, confidence buckets, and false positives", async () => {
    const data = parseBacktestDataset(datasetText);
    const predictor = vi.fn(async (testCase): Promise<BacktestPrediction> => testCase.prediction);
    const report = await buildBacktestReport(data, {
      predict: predictor,
      now: () => new Date("2026-09-11T15:30:00.000Z"),
      gitCommit: async () => "abc123",
      digest: () => "fixture-sha256",
    });

    expect(report).toEqual(
      expect.objectContaining({
        schema_version: 1,
        generated_at: "2026-09-11T15:30:00.000Z",
        git_commit: "abc123",
        fixture_sha256: "fixture-sha256",
        metrics: expect.objectContaining({
          true_positive: 1,
          false_positive: 1,
          false_positive_rate: 1,
        }),
        mean_correct_lead_time_days: 10,
      })
    );
    expect(report.confidence_buckets).toEqual([
      { bucket: "0.60-0.70", total: 1, correct: 0, accuracy: 0 },
      { bucket: "0.80-0.90", total: 1, correct: 1, accuracy: 1 },
    ]);
    expect(report.cases[0]).toEqual(
      expect.objectContaining({ correct: true, lead_time_days: 10 })
    );
  });

  it("propagates predictor failures instead of publishing a partial report", async () => {
    await expect(
      buildBacktestReport(parseBacktestDataset(datasetText), {
        predict: async () => {
          throw new Error("prediction unavailable");
        },
        now: () => new Date(),
        gitCommit: async () => "abc123",
        digest: () => "fixture-sha256",
      })
    ).rejects.toThrow("prediction unavailable");
  });

  it("rejects a predictor response that cites evidence outside the case", async () => {
    await expect(
      buildBacktestReport(parseBacktestDataset(datasetText), {
        predict: async () => ({
          predicted_event: true,
          confidence: 0.9,
          evidence_urls: ["https://attacker.example/post-event"],
          provenance: "bad-run",
        }),
        now: () => new Date(),
        gitCommit: async () => "abc123",
        digest: () => "fixture-sha256",
      })
    ).rejects.toThrow("uncited evidence URL");
  });
});

describe("runBacktest", () => {
  function dependencies(): BacktestDeps {
    return {
      readFile: vi.fn(async () => datasetText),
      writeArtifact: vi.fn(async () => undefined),
      predict: vi.fn(async (testCase) => testCase.prediction),
      now: () => new Date("2026-09-11T15:30:00.000Z"),
      gitCommit: async () => "abc123",
      digest: () => "fixture-sha256",
    };
  }

  it("writes deterministic JSON to an explicit output path", async () => {
    const deps = dependencies();
    const result = await runBacktest(
      ["--file=/fixtures/events.json", "--output=/reports/backtest.json"],
      deps
    );

    expect(deps.readFile).toHaveBeenCalledWith("/fixtures/events.json");
    expect(deps.writeArtifact).toHaveBeenCalledWith(
      "/reports/backtest.json",
      `${JSON.stringify(result.report, null, 2)}\n`
    );
    expect(result.output_path).toBe("/reports/backtest.json");
  });

  it("derives a portable artifact name and rejects missing input", async () => {
    const deps = dependencies();
    const result = await runBacktest(["--file=events.json"], deps);
    expect(result.output_path).toBe("backtest-results-2026-09-11T15-30-00-000Z.json");
    await expect(runBacktest([], deps)).rejects.toThrow("Required");
  });
});
