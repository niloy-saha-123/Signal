import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workerClose = vi.fn().mockResolvedValue(undefined);
  const makeInit = () => vi.fn(() => ({ close: workerClose }));
  return {
    workerClose,
    initRegistry: vi.fn(() => ({
      competitorDiscoveryWorker: { close: workerClose },
      companyProfileUpdateWorker: { close: workerClose },
    })),
    initReddit: makeInit(),
    initHn: makeInit(),
    initJobs: makeInit(),
    initChangelog: makeInit(),
    initPricing: makeInit(),
    initEntity: makeInit(),
    initQuality: makeInit(),
    initDedup: makeInit(),
    initAnalysis: makeInit(),
    registerSchedules: vi.fn().mockResolvedValue(undefined),
    closeQueue: vi.fn().mockResolvedValue(undefined),
    closeRedis: vi.fn().mockResolvedValue(undefined),
    closeDb: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./src/queues/registry", () => ({
  initWorkers: mocks.initRegistry,
  queues: { analysis: { close: mocks.closeQueue }, reddit: { close: mocks.closeQueue } },
}));
vi.mock("./src/queues/scheduler", () => ({ registerCollectorSchedules: mocks.registerSchedules }));
vi.mock("./src/collectors/reddit", () => ({ initRedditWorker: mocks.initReddit }));
vi.mock("./src/collectors/hn", () => ({ initHnWorker: mocks.initHn }));
vi.mock("./src/collectors/jobs", () => ({ initJobsWorker: mocks.initJobs }));
vi.mock("./src/collectors/changelog", () => ({ initChangelogWorker: mocks.initChangelog }));
vi.mock("./src/collectors/pricing", () => ({ initPricingWorker: mocks.initPricing }));
vi.mock("./src/pipeline/entity-extractor", () => ({ initEntityExtractorWorker: mocks.initEntity }));
vi.mock("./src/pipeline/quality-scorer", () => ({ initQualityScorerWorker: mocks.initQuality }));
vi.mock("./src/pipeline/deduplicator", () => ({ initDeduplicatorWorker: mocks.initDedup }));
vi.mock("./src/agents/analysis/analysis-worker", () => ({ initAnalysisWorker: mocks.initAnalysis }));
vi.mock("./src/lib/redis-client", () => ({ closeRedisConnections: mocks.closeRedis }));
vi.mock("./src/db/client", () => ({ closeDatabase: mocks.closeDb }));
vi.mock("./src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createWorkerRuntime, validateWorkerEnvironment } from "./worker";

describe("standalone worker runtime", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has no worker or scheduler startup side effects on import", () => {
    expect(mocks.registerSchedules).not.toHaveBeenCalled();
    expect(mocks.initRegistry).not.toHaveBeenCalled();
    expect(mocks.initAnalysis).not.toHaveBeenCalled();
  });

  it("validates the worker infrastructure environment", () => {
    expect(() => validateWorkerEnvironment({})).toThrow(/DATABASE_URL/);
    expect(() =>
      validateWorkerEnvironment({ DATABASE_URL: "postgres://db", REDIS_URL: "redis://cache" })
    ).not.toThrow();
  });

  it("registers schedules, composes all 11 workers, and closes every owned resource", async () => {
    const runtime = createWorkerRuntime();
    await runtime.start();

    expect(mocks.registerSchedules).toHaveBeenCalledTimes(1);
    expect(mocks.initRegistry).toHaveBeenCalledTimes(1);
    expect(mocks.initReddit).toHaveBeenCalledTimes(1);
    expect(mocks.initHn).toHaveBeenCalledTimes(1);
    expect(mocks.initJobs).toHaveBeenCalledTimes(1);
    expect(mocks.initChangelog).toHaveBeenCalledTimes(1);
    expect(mocks.initPricing).toHaveBeenCalledTimes(1);
    expect(mocks.initEntity).toHaveBeenCalledTimes(1);
    expect(mocks.initQuality).toHaveBeenCalledTimes(1);
    expect(mocks.initDedup).toHaveBeenCalledTimes(1);
    expect(mocks.initAnalysis).toHaveBeenCalledTimes(1);

    await runtime.close();
    await runtime.close();
    expect(mocks.workerClose).toHaveBeenCalledTimes(11);
    expect(mocks.closeQueue).toHaveBeenCalledTimes(2);
    expect(mocks.closeRedis).toHaveBeenCalledTimes(1);
    expect(mocks.closeDb).toHaveBeenCalledTimes(1);
  });

  it("closes workers already constructed when a later worker fails during startup", async () => {
    mocks.initJobs.mockImplementationOnce(() => {
      throw new Error("jobs worker misconfigured");
    });

    const runtime = createWorkerRuntime();
    await expect(runtime.start()).rejects.toThrow("jobs worker misconfigured");

    // Two registry workers plus Reddit and HN were created before Jobs failed.
    expect(mocks.workerClose).toHaveBeenCalledTimes(4);
  });
});
