import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));

const { listDuePredictionsMock, resolvePredictionMock } = vi.hoisted(() => ({
  listDuePredictionsMock: vi.fn(),
  resolvePredictionMock: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  listDuePredictions: listDuePredictionsMock,
  resolvePrediction: resolvePredictionMock,
}));

const { resolvePredictionCriteriaMock } = vi.hoisted(() => ({
  resolvePredictionCriteriaMock: vi.fn(),
}));
vi.mock("@/agents/resolver/prediction-resolver", () => ({
  resolvePredictionCriteria: resolvePredictionCriteriaMock,
}));

const { registerWorkerMock } = vi.hoisted(() => ({ registerWorkerMock: vi.fn() }));
vi.mock("@/queues/registry", () => ({ registerWorker: registerWorkerMock, queues: {} }));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

import { predictionResolverProcessor } from "@/agents/resolver/resolver-worker";
import { isCircuitOpen, recordFailure, recordSuccess } from "@/reliability/circuit-breaker";
import type { Job } from "bullmq";

const job = {} as Job<Record<string, never>>;
const NOW = new Date("2026-12-25T00:00:00.000Z");

function due(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    competitor_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    probability: 0.72,
    created_at: new Date("2026-09-25T00:00:00.000Z"),
    resolves_at: new Date("2026-12-24T00:00:00.000Z"),
    resolution_criteria: { kind: "github_release", repo: "acme/next", mentions: ["postgres"] },
    ...overrides,
  };
}

describe("prediction resolver worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.mocked(isCircuitOpen).mockResolvedValue(false);
    listDuePredictionsMock.mockResolvedValue([]);
    resolvePredictionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes a hit with its Brier score, note and evidence", async () => {
    listDuePredictionsMock.mockResolvedValue([due()]);
    resolvePredictionCriteriaMock.mockResolvedValue({
      status: "hit",
      note: "acme/next shipped a release mentioning postgres.",
      evidence_urls: ["https://github.com/acme/next/releases/tag/v15.0.0"],
    });

    await predictionResolverProcessor(job);

    expect(resolvePredictionMock).toHaveBeenCalledTimes(1);
    const [update] = resolvePredictionMock.mock.calls[0];
    expect(update.status).toBe("hit");
    // (0.72 - 1)^2
    expect(update.brier_score).toBeCloseTo(0.0784, 10);
    expect(update.resolution_note).toContain("postgres");
    expect(update.resolution_evidence_urls).toHaveLength(1);
    expect(update.resolved_at).toEqual(NOW);
  });

  it("writes a miss with the Brier score that confidence earned", async () => {
    listDuePredictionsMock.mockResolvedValue([due({ probability: 0.9 })]);
    resolvePredictionCriteriaMock.mockResolvedValue({
      status: "miss",
      note: "Releases shipped and none matched.",
      evidence_urls: [],
    });

    await predictionResolverProcessor(job);

    const [update] = resolvePredictionMock.mock.calls[0];
    expect(update.status).toBe("miss");
    // (0.9 - 0)^2 — being confident and wrong has to cost.
    expect(update.brier_score).toBeCloseTo(0.81, 10);
  });

  it("stores an unresolved prediction with no Brier score at all", async () => {
    // Review Focus #1. An unresolved window says nothing about accuracy, so it
    // must not carry a score that would later be averaged into the ledger.
    listDuePredictionsMock.mockResolvedValue([due()]);
    resolvePredictionCriteriaMock.mockResolvedValue({
      status: "unresolved",
      note: "No releases in the window.",
      evidence_urls: [],
    });

    await predictionResolverProcessor(job);

    const [update] = resolvePredictionMock.mock.calls[0];
    expect(update.status).toBe("unresolved");
    expect(update.brier_score).toBeNull();
  });

  it("keeps sweeping after one prediction fails to resolve", async () => {
    listDuePredictionsMock.mockResolvedValue([
      due({ id: "bad" }),
      due({ id: "good" }),
    ]);
    resolvePredictionCriteriaMock
      .mockRejectedValueOnce(new Error("resolver blew up"))
      .mockResolvedValueOnce({ status: "hit", note: "ok", evidence_urls: [] });

    await predictionResolverProcessor(job);

    // The healthy one still got written.
    expect(resolvePredictionMock).toHaveBeenCalledTimes(1);
    expect(resolvePredictionMock.mock.calls[0][0].id).toBe("good");
    expect(recordFailure).toHaveBeenCalled();
    // A sweep containing a failure never force-closes the breaker.
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("records success for a clean sweep", async () => {
    listDuePredictionsMock.mockResolvedValue([due()]);
    resolvePredictionCriteriaMock.mockResolvedValue({
      status: "hit",
      note: "ok",
      evidence_urls: [],
    });

    await predictionResolverProcessor(job);

    expect(recordSuccess).toHaveBeenCalledWith("prediction-resolver");
  });

  it("does nothing and stays healthy when nothing is due", async () => {
    listDuePredictionsMock.mockResolvedValue([]);

    await predictionResolverProcessor(job);

    expect(resolvePredictionMock).not.toHaveBeenCalled();
    expect(recordSuccess).toHaveBeenCalledWith("prediction-resolver");
  });

  it("throws when the circuit is already open", async () => {
    vi.mocked(isCircuitOpen).mockResolvedValue(true);

    await expect(predictionResolverProcessor(job)).rejects.toThrow(/circuit is open/);
  });
});
