import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSignalByIdMock, updateSignalQualityScoreMock } = vi.hoisted(() => ({
  getSignalByIdMock: vi.fn(),
  updateSignalQualityScoreMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/queries", () => ({
  getSignalById: getSignalByIdMock,
  updateSignalQualityScore: updateSignalQualityScoreMock,
}));

const { queueAddMock, registerWorkerMock } = vi.hoisted(() => ({
  queueAddMock: vi.fn().mockResolvedValue(undefined),
  registerWorkerMock: vi.fn(),
}));

vi.mock("../queues/registry", () => ({
  registerWorker: registerWorkerMock,
  queues: { "pipeline-deduplication": { add: queueAddMock } },
}));

import {
  sourceAuthorityScore,
  recencyScore,
  completenessScore,
  computeQualityScore,
  qualityScorerProcessor,
  initQualityScorerWorker,
  RECENCY_HALF_LIFE_DAYS,
} from "./quality-scorer";

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

  it("scores lower when title is missing", () => {
    const score = completenessScore(null, "This is a sufficiently long body of raw text.");
    expect(score).toBeLessThan(1.0);
    expect(score).toBeGreaterThan(0);
  });

  it("scores lower when raw_text is present but too short", () => {
    const score = completenessScore("A real title", "short");
    expect(score).toBeLessThan(1.0);
    expect(score).toBeGreaterThan(0);
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
  it("combines authority/recency/completeness and stays within [0, 1]", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    const score = computeQualityScore(
      { source: "pricing", collected_at: now, title: "Pricing changed", raw_text: "New pricing tiers announced today with three new plans." },
      now
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

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
    expect(good).toBeGreaterThan(bad);
  });

  it("never exceeds 1 or drops below 0 across the extremes", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    const max = computeQualityScore(
      { source: "pricing", collected_at: now, title: "T", raw_text: "This is a sufficiently long body of raw text." },
      now
    );
    const min = computeQualityScore(
      { source: "reddit", collected_at: new Date(0), title: null, raw_text: "" },
      now
    );
    expect(max).toBeLessThanOrEqual(1);
    expect(min).toBeGreaterThanOrEqual(0);
  });
});

describe("pipeline/quality-scorer — qualityScorerProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSignalByIdMock.mockResolvedValue(baseSignal);
    updateSignalQualityScoreMock.mockResolvedValue(undefined);
    queueAddMock.mockResolvedValue(undefined);
  });

  it("returns early without writing or enqueuing when the signal is not found", async () => {
    getSignalByIdMock.mockResolvedValue(undefined);

    await expect(
      qualityScorerProcessor({ id: "job1", data: { signal_id: "missing" } } as never)
    ).resolves.toBeUndefined();

    expect(updateSignalQualityScoreMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("writes a clamped [0,1] score via updateSignalQualityScore", async () => {
    await qualityScorerProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(updateSignalQualityScoreMock).toHaveBeenCalledTimes(1);
    const [id, score] = updateSignalQualityScoreMock.mock.calls[0];
    expect(id).toBe("s1");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("enqueues pipeline-deduplication with the signal_id after scoring", async () => {
    await qualityScorerProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(queueAddMock).toHaveBeenCalledWith("deduplicate", { signal_id: "s1" });
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
