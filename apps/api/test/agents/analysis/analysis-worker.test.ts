import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCompetitorByIdMock, failRunIfRunningMock, invokeMock, registerWorkerMock, loggerMock } =
  vi.hoisted(() => ({
    getCompetitorByIdMock: vi.fn(),
    failRunIfRunningMock: vi.fn(),
    invokeMock: vi.fn(),
    registerWorkerMock: vi.fn(),
    loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));

vi.mock("@/db/queries", () => ({
  getCompetitorById: getCompetitorByIdMock,
  failRunIfRunning: failRunIfRunningMock,
}));

vi.mock("@/graph/analysis-graph", () => ({
  analysisGraph: { invoke: invokeMock },
}));

vi.mock("@/queues/registry", () => ({
  registerWorker: registerWorkerMock,
}));

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

import {
  AnalysisTimeoutError,
  analysisJobProcessor,
  createAnalysisJobProcessor,
  initAnalysisWorker,
} from "@/agents/analysis/analysis-worker";

const COMPETITOR_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

function job(data: unknown = {
  competitor_id: COMPETITOR_ID,
  run_id: RUN_ID,
  has_pricing_diff: true,
}) {
  return { id: "job-1", data, attemptsMade: 0, opts: { attempts: 1 } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompetitorByIdMock.mockResolvedValue({ id: COMPETITOR_ID });
  failRunIfRunningMock.mockResolvedValue(undefined);
  invokeMock.mockResolvedValue({ decision: { action: "digest", reason: "normal" } });
  registerWorkerMock.mockReturnValue({ name: "analysis" });
});

describe("analysis job processor", () => {
  it("rejects malformed BullMQ data before touching the database or graph", async () => {
    await expect(analysisJobProcessor(job({ run_id: "not-a-uuid" }))).rejects.toThrow();
    expect(getCompetitorByIdMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(failRunIfRunningMock).not.toHaveBeenCalled();
  });

  it("fails the run and throws when the competitor no longer exists", async () => {
    getCompetitorByIdMock.mockResolvedValueOnce(undefined);

    await expect(analysisJobProcessor(job())).rejects.toThrow(
      `analysis: competitor ${COMPETITOR_ID} not found`
    );
    expect(failRunIfRunningMock).toHaveBeenCalledWith(RUN_ID);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes the graph with only the validated caller-owned state", async () => {
    await expect(analysisJobProcessor(job())).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith({
      competitor_id: COMPETITOR_ID,
      run_id: RUN_ID,
      has_pricing_diff: true,
    });
    expect(failRunIfRunningMock).not.toHaveBeenCalled();
  });

  it("best-effort fails the run and preserves the graph error for BullMQ retry", async () => {
    const graphError = new Error("provider unavailable");
    invokeMock.mockRejectedValueOnce(graphError);
    failRunIfRunningMock.mockRejectedValueOnce(new Error("postgres unavailable"));

    await expect(analysisJobProcessor(job())).rejects.toBe(graphError);
    expect(failRunIfRunningMock).toHaveBeenCalledWith(RUN_ID);
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("mark analysis run failed"),
      expect.objectContaining({ run_id: RUN_ID })
    );
  });

  it("leaves the run open while BullMQ still has another attempt", async () => {
    invokeMock.mockRejectedValueOnce(new Error("transient provider failure"));
    const retryableJob = job();
    retryableJob.opts.attempts = 3;
    retryableJob.attemptsMade = 0;

    await expect(analysisJobProcessor(retryableJob)).rejects.toThrow("transient provider failure");
    expect(failRunIfRunningMock).not.toHaveBeenCalled();
  });

  it("gives up at the wall-clock bound and fails the run", async () => {
    vi.useFakeTimers();
    invokeMock.mockReturnValueOnce(new Promise(() => undefined));
    const processor = createAnalysisJobProcessor(25);

    const pending = processor(job());
    const rejection = expect(pending).rejects.toBeInstanceOf(AnalysisTimeoutError);
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(failRunIfRunningMock).toHaveBeenCalledWith(RUN_ID);
    vi.useRealTimers();
  });
});

describe("initAnalysisWorker", () => {
  it("registers the analysis processor without import-time worker creation", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();
    const worker = initAnalysisWorker();
    expect(registerWorkerMock).toHaveBeenCalledWith("analysis", analysisJobProcessor);
    expect(worker).toEqual({ name: "analysis" });
  });
});
