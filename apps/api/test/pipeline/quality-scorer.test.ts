import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSignalByIdMock, scoreSignalAndAdvanceOutboxMock } = vi.hoisted(() => ({
  getSignalByIdMock: vi.fn(),
  scoreSignalAndAdvanceOutboxMock: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/db/queries", () => ({
  getSignalById: getSignalByIdMock,
  scoreSignalAndAdvanceOutbox: scoreSignalAndAdvanceOutboxMock,
}));

const { queueAddMock, registerWorkerMock } = vi.hoisted(() => ({
  queueAddMock: vi.fn().mockResolvedValue(undefined),
  registerWorkerMock: vi.fn(),
}));

vi.mock("@/queues/registry", () => ({
  registerWorker: registerWorkerMock,
  queues: { "pipeline-deduplication": { add: queueAddMock } },
}));
const { ensureSignalPipelineJobMock } = vi.hoisted(() => ({
  ensureSignalPipelineJobMock: vi.fn(),
}));
vi.mock("@/pipeline/recovery", () => ({
  ensureSignalPipelineJob: ensureSignalPipelineJobMock,
}));

import {
  sourceAuthorityScore,
  recencyScore,
  completenessScore,
  computeQualityScore,
  qualityScorerProcessor,
  initQualityScorerWorker,
  RECENCY_HALF_LIFE_DAYS,
} from "@/pipeline/quality-scorer";

const baseSignal = {
  id: "s1",
  competitor_id: "c1",
  source: "reddit" as const,
  source_url: null,
  title: "Acme launches Widget Pro",
  raw_text: "Acme just launched Widget Pro for $99/month with SSO support.",
  quality_score: 0,
  entities: {},
  cluster_id: null,
  collected_at: new Date(),
  created_at: new Date(),
};

describe("pipeline/quality-scorer — sourceAuthorityScore", () => {
  it("ranks pricing highest (first-party, most direct competitive signal)", () => {
    expect(sourceAuthorityScore("pricing")).toBeGreaterThan(sourceAuthorityScore("changelog"));
  });

  it("ranks changelog above jobs (both first-party, changelog more directly competitive)", () => {
    expect(sourceAuthorityScore("changelog")).toBeGreaterThan(sourceAuthorityScore("jobs"));
  });

  it("ranks jobs above community sources (first-party vs third-party)", () => {
    expect(sourceAuthorityScore("jobs")).toBeGreaterThan(sourceAuthorityScore("hn"));
    expect(sourceAuthorityScore("jobs")).toBeGreaterThan(sourceAuthorityScore("reddit"));
  });

  it("every weight is within [0, 1]", () => {
    for (const source of ["pricing", "changelog", "jobs", "hn", "reddit"] as const) {
      const score = sourceAuthorityScore(source);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe("pipeline/quality-scorer — recencyScore", () => {
  it("returns 1.0 for a signal collected right now", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    expect(recencyScore(now, now)).toBeCloseTo(1.0, 5);
  });

  it("returns exactly 0.5 at one half-life old", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    const collectedAt = new Date(now.getTime() - RECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
    expect(recencyScore(collectedAt, now)).toBeCloseTo(0.5, 5);
  });

  it("returns 0.25 at two half-lives old", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    const collectedAt = new Date(now.getTime() - 2 * RECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
    expect(recencyScore(collectedAt, now)).toBeCloseTo(0.25, 5);
  });

  it("decays toward 0 for a very old signal but never goes negative", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    const collectedAt = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const score = recencyScore(collectedAt, now);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(0.01);
  });

  it("clamps to 1.0 for a collected_at that is (clock-skew) in the future", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    const collectedAt = new Date(now.getTime() + 60 * 60 * 1000);
    expect(recencyScore(collectedAt, now)).toBe(1.0);
  });
});

describe("pipeline/quality-scorer — completenessScore", () => {
  it("scores highest when both title and a non-trivial raw_text are present", () => {
    const score = completenessScore("A real title", "This is a sufficiently long body of raw text.");
    expect(score).toBe(1.0);
  });

  it("scores exactly 0.5 when title is missing but raw_text is non-trivial", () => {
    expect(completenessScore(null, "This is a sufficiently long body of raw text.")).toBe(0.5);
  });

  it("scores exactly 0.5 when title is present but raw_text is too short", () => {
    expect(completenessScore("A real title", "short")).toBe(0.5);
  });

  it("scores 0 when both title is missing and raw_text is too short", () => {
    expect(completenessScore(null, "short")).toBe(0);
  });

  it("treats an empty-string title the same as a missing title", () => {
    expect(completenessScore("", "This is a sufficiently long body of raw text.")).toBe(
      completenessScore(null, "This is a sufficiently long body of raw text.")
    );
  });
});

describe("pipeline/quality-scorer — computeQualityScore", () => {
  // Weights: authority 0.5, recency 0.4, completeness 0.1 (AUTHORITY_WEIGHT/RECENCY_WEIGHT/
  // COMPLETENESS_WEIGHT in quality-scorer.ts). pricing authority = 1.0, collected_at === now
  // gives recency = 1.0, title + long raw_text gives completeness = 1.0:
  // 0.5*1.0 + 0.4*1.0 + 0.1*1.0 = 1.0 exactly.
  it("combines authority/recency/completeness and stays within [0, 1]", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    const score = computeQualityScore(
      { source: "pricing", collected_at: now, title: "Pricing changed", raw_text: "New pricing tiers announced today with three new plans." },
      now
    );
    expect(score).toBeCloseTo(1.0, 5);
  });

  // good: same inputs as above -> 1.0 exactly.
  // bad: reddit authority = 0.3 (the third-party floor, not 0), 30-day-old collected_at ->
  // recency = 0.5^(30/7) = 0.05127095975047738, title null + raw_text "meh" (< 30 chars) ->
  // completeness = 0.0. 0.5*0.3 + 0.4*0.05127095975047738 + 0.1*0 = 0.17050838390019096.
  it("scores a fresh, high-authority, complete signal higher than a stale, low-authority, incomplete one", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    const good = computeQualityScore(
      { source: "pricing", collected_at: now, title: "Pricing changed", raw_text: "New pricing tiers announced today with three new plans." },
      now
    );
    const stale = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const bad = computeQualityScore(
      { source: "reddit", collected_at: stale, title: null, raw_text: "meh" },
      now
    );
    expect(good).toBeCloseTo(1.0, 5);
    expect(bad).toBeCloseTo(0.17050838390019096, 5);
    expect(good).toBeGreaterThan(bad);
  });

  // max: pricing/now/title/long raw_text -> 1.0 exactly, same as above.
  // min: reddit authority = 0.3, collected_at at the Unix epoch (~56 years before `now`) decays
  // recency to 0 (Math.pow(0.5, hugeExponent) underflows to 0 in double precision), title null
  // + empty raw_text -> completeness = 0. 0.5*0.3 + 0.4*0 + 0.1*0 = 0.15 exactly — not 0, because
  // the reddit authority floor alone contributes 0.15 regardless of how stale/incomplete the
  // rest of the signal is.
  it("never exceeds 1 or drops below the reddit-authority floor across the extremes", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    const max = computeQualityScore(
      { source: "pricing", collected_at: now, title: "T", raw_text: "This is a sufficiently long body of raw text." },
      now
    );
    const min = computeQualityScore(
      { source: "reddit", collected_at: new Date(0), title: null, raw_text: "" },
      now
    );
    expect(max).toBeCloseTo(1.0, 5);
    expect(min).toBeCloseTo(0.15, 5);
  });
});

describe("pipeline/quality-scorer — qualityScorerProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSignalByIdMock.mockResolvedValue(baseSignal);
    queueAddMock.mockResolvedValue(undefined);
    scoreSignalAndAdvanceOutboxMock.mockResolvedValue(true);
    ensureSignalPipelineJobMock.mockImplementation(async (_stage: string, signalId: string) => {
      await queueAddMock("deduplicate", { signal_id: signalId });
      return "added";
    });
  });

  it("returns early without writing or enqueuing when the signal is not found", async () => {
    getSignalByIdMock.mockResolvedValue(undefined);

    await expect(
      qualityScorerProcessor({ id: "job1", data: { signal_id: "missing" } } as never)
    ).resolves.toBeUndefined();

    expect(scoreSignalAndAdvanceOutboxMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("atomically writes a clamped score and advances the owned outbox stage", async () => {
    await qualityScorerProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(scoreSignalAndAdvanceOutboxMock).toHaveBeenCalledTimes(1);
    const [id, score] = scoreSignalAndAdvanceOutboxMock.mock.calls[0];
    expect(id).toBe("s1");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("enqueues pipeline-deduplication with the signal_id after scoring", async () => {
    await qualityScorerProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(queueAddMock).toHaveBeenCalledWith("deduplicate", { signal_id: "s1" });
  });

  it("commits score and stage before attempting the next enqueue", async () => {
    await qualityScorerProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(scoreSignalAndAdvanceOutboxMock.mock.invocationCallOrder[0]).toBeLessThan(
      ensureSignalPipelineJobMock.mock.invocationCallOrder[0]
    );
  });

  it("leaves deduplication recoverable when immediate enqueue fails", async () => {
    ensureSignalPipelineJobMock.mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(
      qualityScorerProcessor({ id: "job1", data: { signal_id: "s1" } } as never)
    ).rejects.toThrow("Redis unavailable");
    expect(scoreSignalAndAdvanceOutboxMock).toHaveBeenCalledWith("s1", expect.any(Number));
  });

  it("does not enqueue when a retry no longer owns the quality-scoring stage", async () => {
    scoreSignalAndAdvanceOutboxMock.mockResolvedValueOnce(false);

    await qualityScorerProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(scoreSignalAndAdvanceOutboxMock).toHaveBeenCalledTimes(1);
    expect(ensureSignalPipelineJobMock).not.toHaveBeenCalled();
  });

  it("registers the pipeline-quality-scoring worker via initQualityScorerWorker without registering at import time", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();

    initQualityScorerWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith(
      "pipeline-quality-scoring",
      qualityScorerProcessor
    );
  });
});
