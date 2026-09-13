import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOutbox: vi.fn(),
  ensureStableJob: vi.fn(),
  registerWorker: vi.fn(),
  queues: {
    "pipeline-entity-extraction": { getJob: vi.fn(), add: vi.fn() },
    "pipeline-quality-scoring": { getJob: vi.fn(), add: vi.fn() },
    "pipeline-deduplication": { getJob: vi.fn(), add: vi.fn() },
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/db/queries", () => ({
  listPendingSignalPipelineOutbox: mocks.listOutbox,
}));

vi.mock("@/queues/registry", () => ({
  ensureStableJob: mocks.ensureStableJob,
  registerWorker: mocks.registerWorker,
  queues: mocks.queues,
}));
vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));

import {
  PIPELINE_RECOVERY_BATCH_SIZE,
  ensureSignalPipelineJob,
  initPipelineRecoveryWorker,
  pipelineJobId,
  pipelineRecoveryProcessor,
  enqueueInitialSignalPipeline,
} from "@/pipeline/recovery";

const signalId = "11111111-1111-4111-8111-111111111111";

describe("pipeline recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOutbox.mockResolvedValue([]);
    mocks.ensureStableJob.mockResolvedValue("added");
  });

  it.each([
    ["entity_extraction", "pipeline-entity-extraction-11111111-1111-4111-8111-111111111111"],
    ["quality_scoring", "pipeline-quality-scoring-11111111-1111-4111-8111-111111111111"],
    ["deduplication", "pipeline-deduplication-11111111-1111-4111-8111-111111111111"],
  ] as const)("derives a colon-free stable job id for %s", (stage, expected) => {
    expect(pipelineJobId(stage, signalId)).toBe(expected);
    expect(pipelineJobId(stage, signalId)).not.toContain(":");
  });

  it("ensures the queue and job payload matching a pipeline stage", async () => {
    await ensureSignalPipelineJob("quality_scoring", signalId, { repairCompleted: true });

    expect(mocks.ensureStableJob).toHaveBeenCalledWith(
      mocks.queues["pipeline-quality-scoring"],
      {
        name: "score-quality",
        data: { signal_id: signalId },
        jobId: `pipeline-quality-scoring-${signalId}`,
        repairCompleted: true,
      }
    );
  });

  it("defers an immediate enqueue failure to the durable outbox", async () => {
    mocks.ensureStableJob.mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(enqueueInitialSignalPipeline(signalId)).resolves.toBe("deferred");
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("deferred to pipeline outbox"),
      expect.objectContaining({ signal_id: signalId, error: "Redis unavailable" })
    );
  });

  it("reconciles only one bounded oldest-first outbox batch", async () => {
    mocks.listOutbox.mockResolvedValue([
      { signal_id: signalId, stage: "entity_extraction" },
      { signal_id: "22222222-2222-4222-8222-222222222222", stage: "deduplication" },
    ]);

    await pipelineRecoveryProcessor({ data: {} } as never);

    expect(mocks.listOutbox).toHaveBeenCalledWith(PIPELINE_RECOVERY_BATCH_SIZE);
    expect(mocks.ensureStableJob).toHaveBeenCalledTimes(2);
    expect(mocks.ensureStableJob).toHaveBeenNthCalledWith(
      1,
      mocks.queues["pipeline-entity-extraction"],
      expect.objectContaining({ repairCompleted: true })
    );
    expect(mocks.ensureStableJob).toHaveBeenNthCalledWith(
      2,
      mocks.queues["pipeline-deduplication"],
      expect.objectContaining({ repairCompleted: true })
    );
  });

  it("rejects malformed recovery job data before querying Postgres", async () => {
    await expect(pipelineRecoveryProcessor({ data: { untrusted: true } } as never)).rejects.toThrow();
    expect(mocks.listOutbox).not.toHaveBeenCalled();
  });

  it("registers a concurrency-owned pipeline recovery worker without import side effects", () => {
    expect(mocks.registerWorker).not.toHaveBeenCalled();
    initPipelineRecoveryWorker();
    expect(mocks.registerWorker).toHaveBeenCalledWith("pipeline-recovery", pipelineRecoveryProcessor);
  });
});
