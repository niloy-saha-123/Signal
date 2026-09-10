import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/redis-client", () => ({
  redis: { __fake: "shared-redis-connection" },
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  getCompetitorByIdMock,
  updateDiscoveryStatusMock,
  finalizeDiscoveryMock,
  discoverCompetitorMock,
  listCompetitorsMock,
  createAgentRunMock,
  getRecentPricingDiffsMock,
  failRunIfRunningMock,
} = vi.hoisted(() => ({
  getCompetitorByIdMock: vi.fn(),
  updateDiscoveryStatusMock: vi.fn(),
  finalizeDiscoveryMock: vi.fn(),
  discoverCompetitorMock: vi.fn(),
  listCompetitorsMock: vi.fn(),
  createAgentRunMock: vi.fn(),
  getRecentPricingDiffsMock: vi.fn(),
  failRunIfRunningMock: vi.fn(),
}));

vi.mock("../lib/logger", () => ({ logger: loggerMock }));

vi.mock("../reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/queries", () => ({
  getCompetitorById: getCompetitorByIdMock,
  updateDiscoveryStatus: updateDiscoveryStatusMock,
  finalizeDiscovery: finalizeDiscoveryMock,
  listCompetitors: listCompetitorsMock,
  createAgentRun: createAgentRunMock,
  getRecentPricingDiffs: getRecentPricingDiffsMock,
  failRunIfRunning: failRunIfRunningMock,
}));

vi.mock("../agents/discovery/competitor-discovery", () => ({
  discoverCompetitor: discoverCompetitorMock,
}));

const {
  queueCtorCalls,
  workerCtorCalls,
  insertMock,
  insertValuesMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  transactionMock,
  queueAddMock,
} = vi.hoisted(() => {
  const insertValuesMock = vi.fn().mockResolvedValue(undefined);
  const insertMock = vi.fn().mockReturnValue({ values: insertValuesMock });
  const updateWhereMock = vi.fn().mockResolvedValue(undefined);
  const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
  const updateMock = vi.fn().mockReturnValue({ set: updateSetMock });
  // Real drizzle transaction hands the callback a `tx` with the same
  // query-builder surface as `db` — reuse the same insert/update mocks so
  // assertions don't care whether the code called db.X or tx.X.
  const transactionMock = vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<void>) =>
    cb({ insert: insertMock, update: updateMock })
  );
  const queueAddMock = vi.fn().mockResolvedValue(undefined);
  return {
    queueCtorCalls: [] as Array<{ name: string; opts: unknown }>,
    workerCtorCalls: [] as Array<{ name: string; processor: unknown; opts: unknown; instance: unknown }>,
    insertMock,
    insertValuesMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
    transactionMock,
    queueAddMock,
  };
});

vi.mock("../db/client", () => ({
  db: { insert: insertMock, update: updateMock, transaction: transactionMock },
}));

vi.mock("bullmq", async () => {
  const { EventEmitter } = await import("node:events");
  class Queue {
    name: string;
    opts: unknown;
    constructor(name: string, opts: unknown) {
      this.name = name;
      this.opts = opts;
      queueCtorCalls.push({ name, opts });
    }
    add(name: string, data: unknown) {
      return queueAddMock(name, data);
    }
  }
  class Worker extends EventEmitter {
    name: string;
    processor: unknown;
    opts: unknown;
    constructor(name: string, processor: unknown, opts: unknown) {
      super();
      this.name = name;
      this.processor = processor;
      this.opts = opts;
      workerCtorCalls.push({ name, processor, opts, instance: this });
    }
  }
  return { Queue, Worker };
});

import { redis } from "../lib/redis-client";
import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { competitorDiscoveryLogTable, competitorsTable } from "../db/schema";
import {
  connection,
  QUEUE_CONFIG,
  queues,
  registerWorker,
  initWorkers,
  NotImplementedError,
  type QueueName,
} from "./registry";

// Importing the module (above) must not have constructed any Workers — only
// Queues are import-time side effects. Snapshot before calling initWorkers()
// below so a test can assert on it.
const workerCountBeforeInit = workerCtorCalls.length;

// Worker construction is gated behind initWorkers() (never runs as an import
// side effect, so Express can import `queues` without also starting live
// Workers) — call it once here, the way the real worker-process entrypoint
// would, so the describe blocks below that inspect the competitor-discovery /
// company-profile-update workers have something to find.
initWorkers();

const OTHER_QUEUES: QueueName[] = [
  "collect-reddit",
  "collect-hn",
  "collect-jobs",
  "collect-changelog",
  "collect-pricing",
  "pipeline-entity-extraction",
  "pipeline-quality-scoring",
  "pipeline-deduplication",
  "analysis",
];

describe("queues/registry", () => {
  it("reuses the shared redis connection from lib/redis-client rather than creating a new one", () => {
    expect(connection).toBe(redis);
  });

  it("does not construct any Worker as a side effect of importing the module", () => {
    expect(workerCountBeforeInit).toBe(0);
  });

  it("configures competitor-discovery per the stub: concurrency 3, 2 attempts, 5s fixed delay", () => {
    expect(QUEUE_CONFIG["competitor-discovery"]).toEqual({
      concurrency: 3,
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
      lockDuration: 60_000,
    });
  });

  it("configures company-profile-update per the stub: concurrency 1, no retry", () => {
    expect(QUEUE_CONFIG["company-profile-update"]).toEqual({
      concurrency: 1,
      attempts: 1,
    });
  });

  it("defaults every other queue to concurrency 2, 3 attempts, exponential backoff from 5s", () => {
    for (const name of OTHER_QUEUES) {
      expect(QUEUE_CONFIG[name]).toEqual({
        concurrency: 2,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      });
    }
  });

  it("creates a Queue instance for every configured queue name, on the shared connection", () => {
    const allNames: QueueName[] = ["competitor-discovery", "company-profile-update", ...OTHER_QUEUES];
    expect(Object.keys(queues).sort()).toEqual(allNames.sort());
    for (const name of allNames) {
      expect(queues[name]).toBeDefined();
    }
    expect(queueCtorCalls).toHaveLength(allNames.length);
    for (const call of queueCtorCalls) {
      expect((call.opts as { connection: unknown }).connection).toBe(redis);
    }
  });

  it("bounds completed/failed job retention on every queue's defaultJobOptions", () => {
    for (const call of queueCtorCalls) {
      const jobOptions = (
        call.opts as {
          defaultJobOptions: { removeOnComplete: unknown; removeOnFail: unknown };
        }
      ).defaultJobOptions;
      expect(jobOptions.removeOnComplete).toEqual({ count: 1000 });
      expect(jobOptions.removeOnFail).toEqual({ age: 7 * 24 * 60 * 60 });
    }
  });

  it("registerWorker creates a Worker using that queue's config", () => {
    const processor = vi.fn();
    registerWorker("collect-reddit", processor);

    const call = workerCtorCalls.find((c) => c.name === "collect-reddit");
    expect(call).toBeDefined();
    expect(call?.processor).toBe(processor);
    expect((call?.opts as { concurrency: number }).concurrency).toBe(2);
    expect((call?.opts as { connection: unknown }).connection).toBe(redis);
  });

  it("throws on a second registerWorker call for the same queue name", () => {
    registerWorker("collect-hn", vi.fn());
    expect(() => registerWorker("collect-hn", vi.fn())).toThrow();
  });

  // Without this every failure lands only in Redis's failed-job hash — a stuck signal
  // is then undebuggable from logs. Wired in registerWorker so all 11 queues get it.
  it("logs every job failure with queue, job id/data, attempt counts and the stack", () => {
    loggerMock.error.mockClear();
    registerWorker("analysis", vi.fn());
    const worker = workerCtorCalls.find((c) => c.name === "analysis")
      ?.instance as import("node:events").EventEmitter;
    const err = new Error("boom");

    worker.emit(
      "failed",
      { id: "job-9", data: { signal_id: "s1" }, attemptsMade: 2, opts: { attempts: 3 } },
      err,
      "active"
    );

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("analysis"),
      expect.objectContaining({
        queue: "analysis",
        job_id: "job-9",
        job_data: { signal_id: "s1" },
        attempts_made: 2,
        attempts_allowed: 3,
        error: "boom",
        stack: err.stack,
      })
    );
  });

  // BullMQ can emit 'failed' with a null job (e.g. a stalled job it can't reload) —
  // the listener must not throw inside an event handler.
  it("survives a failed event with no job attached", () => {
    registerWorker("collect-jobs", vi.fn());
    const worker = workerCtorCalls.find((c) => c.name === "collect-jobs")
      ?.instance as import("node:events").EventEmitter;

    expect(() => worker.emit("failed", undefined, new Error("stalled"), "active")).not.toThrow();
  });
});

// Job type from bullmq is fully mocked away above — a plain object with the
// two fields the processor/failed-handler actually read is enough here.
function fakeJob(overrides: { competitor_id?: string; attemptsMade?: number; attempts?: number } = {}) {
  return {
    data: {
      competitor_id: overrides.competitor_id ?? "comp-1",
      name: "Acme",
      domain: "acme.com",
    },
    attemptsMade: overrides.attemptsMade ?? 1,
    opts: { attempts: overrides.attempts ?? 2 },
  };
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("competitor-discovery worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    getCompetitorByIdMock.mockResolvedValue({
      id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      subreddits: ["acme"],
      greenhouse_token: "acme-gh",
      lever_token: null,
      pricing_url: null,
      changelog_rss: "https://acme.com/feed.xml",
      discovery_status: "pending",
    });
    updateDiscoveryStatusMock.mockResolvedValue(undefined);
    discoverCompetitorMock.mockResolvedValue({
      subreddits: ["acme"],
      greenhouse_token: "acme-gh",
      lever_token: "acme-lever",
      pricing_url: "https://acme.com/pricing",
      changelog_rss: "https://acme.com/feed.xml",
      logs: [],
    });
    finalizeDiscoveryMock.mockResolvedValue(undefined);
  });

  function getRegisteredWorker() {
    const call = workerCtorCalls.find((c) => c.name === "competitor-discovery");
    if (!call) throw new Error("competitor-discovery worker was never registered");
    return call;
  }

  it("registers a real Worker for competitor-discovery via initWorkers()", () => {
    const call = getRegisteredWorker();
    expect(typeof call.processor).toBe("function");
    expect((call.opts as { concurrency: number }).concurrency).toBe(3);
    expect((call.opts as { lockDuration: number }).lockDuration).toBe(60_000);
  });

  it("short-circuits with a throw and does no work when the circuit is already open", async () => {
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;

    await expect(processor(fakeJob())).rejects.toThrow();
    expect(getCompetitorByIdMock).not.toHaveBeenCalled();
    expect(discoverCompetitorMock).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("loads current fields, marks discovery in progress, discovers, finalizes, then records success", async () => {
    const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;
    const result = await discoverCompetitorMock();
    discoverCompetitorMock.mockClear();

    await expect(processor(fakeJob())).resolves.toBeUndefined();

    expect(getCompetitorByIdMock).toHaveBeenCalledWith("comp-1");
    expect(updateDiscoveryStatusMock).toHaveBeenCalledWith("comp-1", "in_progress");
    expect(discoverCompetitorMock).toHaveBeenCalledWith({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: {
        subreddits: ["acme"],
        greenhouse_token: "acme-gh",
        lever_token: null,
        pricing_url: null,
        changelog_rss: "https://acme.com/feed.xml",
      },
    });
    expect(finalizeDiscoveryMock).toHaveBeenCalledWith("comp-1", result);
    expect(updateDiscoveryStatusMock.mock.invocationCallOrder[0]).toBeLessThan(
      discoverCompetitorMock.mock.invocationCallOrder[0]
    );
    expect(discoverCompetitorMock.mock.invocationCallOrder[0]).toBeLessThan(
      finalizeDiscoveryMock.mock.invocationCallOrder[0]
    );
    expect(recordSuccess).toHaveBeenCalledWith("competitor-discovery");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  // A retry that reaches a row finalizeDiscovery already committed must not
  // re-probe or append a second set of discovery log rows (review C-1).
  it.each(["complete", "failed"])(
    "skips all work when the competitor is already %s",
    async (status) => {
      getCompetitorByIdMock.mockResolvedValueOnce({
        id: "comp-1",
        subreddits: [],
        greenhouse_token: null,
        lever_token: null,
        pricing_url: null,
        changelog_rss: null,
        discovery_status: status,
      });
      const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;

      await expect(processor(fakeJob())).resolves.toBeUndefined();

      expect(updateDiscoveryStatusMock).not.toHaveBeenCalled();
      expect(discoverCompetitorMock).not.toHaveBeenCalled();
      expect(finalizeDiscoveryMock).not.toHaveBeenCalled();
      expect(recordSuccess).toHaveBeenCalledWith("competitor-discovery");
    }
  );

  it("does not fail a job whose work committed when recordSuccess itself rejects", async () => {
    (recordSuccess as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("redis blip"));
    const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;

    await expect(processor(fakeJob())).resolves.toBeUndefined();

    expect(finalizeDiscoveryMock).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("circuit-breaker success"),
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it("warns when a finalized discovery found no field at all", async () => {
    discoverCompetitorMock.mockResolvedValueOnce({
      subreddits: [],
      greenhouse_token: null,
      lever_token: null,
      pricing_url: null,
      changelog_rss: null,
      logs: [
        { field_name: "greenhouse", attempted_urls: [], discovered_value: null, status: "not_found", error_message: null },
        { field_name: "pricing_url", attempted_urls: [], discovered_value: null, status: "error", error_message: "boom" },
      ],
    });
    const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;

    await processor(fakeJob());

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("no fields discovered"),
      { competitor_id: "comp-1" }
    );
  });

  it("does not warn when at least one field was found", async () => {
    discoverCompetitorMock.mockResolvedValueOnce({
      subreddits: ["acme"],
      greenhouse_token: "acme-gh",
      lever_token: null,
      pricing_url: null,
      changelog_rss: null,
      logs: [
        { field_name: "greenhouse", attempted_urls: [], discovered_value: "acme-gh", status: "found", error_message: null },
      ],
    });
    const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;

    await processor(fakeJob());

    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it("rejects a missing competitor so BullMQ can retry and records the failure", async () => {
    getCompetitorByIdMock.mockResolvedValueOnce(undefined);
    const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;

    await expect(processor(fakeJob())).rejects.toThrow("competitor comp-1 not found");
    expect(updateDiscoveryStatusMock).not.toHaveBeenCalled();
    expect(discoverCompetitorMock).not.toHaveBeenCalled();
    expect(finalizeDiscoveryMock).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(
      "competitor-discovery",
      "competitor comp-1 not found"
    );
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("propagates a discovery failure so BullMQ retries the job", async () => {
    discoverCompetitorMock.mockRejectedValueOnce(new Error("discovery boom"));
    const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;

    await expect(processor(fakeJob())).rejects.toThrow("discovery boom");
    expect(finalizeDiscoveryMock).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith("competitor-discovery", "discovery boom");
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("still throws the original job error, not recordFailure's, when recordFailure itself rejects", async () => {
    discoverCompetitorMock.mockRejectedValueOnce(new Error("original discovery error"));
    (recordFailure as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("redis blip"));
    const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;

    const err = await processor(fakeJob()).catch((e) => e);
    expect(err).toEqual(new Error("original discovery error"));
  });

  it("writes exactly one competitor_discovery_log row and flips discovery_status to failed, atomically, once retries are exhausted", async () => {
    const worker = getRegisteredWorker().instance as import("node:events").EventEmitter;
    const job = fakeJob({ competitor_id: "comp-42", attemptsMade: 2, attempts: 2 });

    worker.emit("failed", job, new Error("nope"), "active");
    await flushAsync();

    // both writes happen inside db.transaction — proves they commit atomically
    expect(transactionMock).toHaveBeenCalledTimes(1);

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(competitorDiscoveryLogTable);
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    const row = insertValuesMock.mock.calls[0][0];
    expect(row).toEqual({
      competitor_id: "comp-42",
      field_name: "subreddits",
      status: "error",
      error_message: expect.stringContaining("nope"),
    });

    expect(updateMock).toHaveBeenCalledWith(competitorsTable);
    expect(updateSetMock).toHaveBeenCalledWith({ discovery_status: "failed" });
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
  });

  it("retries the terminal-failure DB write on a transient failure instead of dropping it", async () => {
    transactionMock.mockRejectedValueOnce(new Error("connection reset"));
    const worker = getRegisteredWorker().instance as import("node:events").EventEmitter;
    const job = fakeJob({ competitor_id: "comp-7", attemptsMade: 2, attempts: 2 });

    worker.emit("failed", job, new Error("nope"), "active");
    // withRetry backs off ~500ms-1s between attempts by default — give it room.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(updateSetMock).toHaveBeenCalledWith({ discovery_status: "failed" });
  }, 10000);

  it("does not write anything when the job has retries remaining", async () => {
    const worker = getRegisteredWorker().instance as import("node:events").EventEmitter;
    const job = fakeJob({ attemptsMade: 1, attempts: 2 });

    worker.emit("failed", job, new Error("transient network blip"), "active");
    await flushAsync();

    expect(transactionMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("company-profile-update worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCompetitorsMock.mockResolvedValue([
      { id: "active-1", is_active: true },
      { id: "inactive-1", is_active: false },
      { id: "active-2", is_active: true },
    ]);
    createAgentRunMock
      .mockResolvedValueOnce({ id: "run-1" })
      .mockResolvedValueOnce({ id: "run-2" });
    getRecentPricingDiffsMock
      .mockResolvedValueOnce([{ id: "diff-1" }])
      .mockResolvedValueOnce([]);
    failRunIfRunningMock.mockResolvedValue(undefined);
    queueAddMock.mockResolvedValue(undefined);
  });

  function getRegisteredWorker() {
    const call = workerCtorCalls.find((c) => c.name === "company-profile-update");
    if (!call) throw new Error("company-profile-update worker was never registered");
    return call;
  }

  it("registers a real Worker for company-profile-update via initWorkers()", () => {
    const call = getRegisteredWorker();
    expect(typeof call.processor).toBe("function");
    expect((call.opts as { concurrency: number }).concurrency).toBe(1);
  });

  it("creates one scheduled run and analysis job per active competitor", async () => {
    const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;
    const job = { data: {} };

    await expect(processor(job)).resolves.toBeUndefined();
    expect(createAgentRunMock).toHaveBeenCalledTimes(2);
    expect(createAgentRunMock).toHaveBeenNthCalledWith(1, {
      competitor_id: "active-1",
      trigger: "scheduled",
    });
    expect(createAgentRunMock).toHaveBeenNthCalledWith(2, {
      competitor_id: "active-2",
      trigger: "scheduled",
    });
    expect(queueAddMock).toHaveBeenNthCalledWith(1, "analysis", {
      competitor_id: "active-1",
      run_id: "run-1",
      has_pricing_diff: true,
    });
    expect(queueAddMock).toHaveBeenNthCalledWith(2, "analysis", {
      competitor_id: "active-2",
      run_id: "run-2",
      has_pricing_diff: false,
    });
    expect(getRecentPricingDiffsMock).not.toHaveBeenCalledWith("inactive-1", expect.anything());
  });
});
