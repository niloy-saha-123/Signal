import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/redis-client", () => ({
  redis: { __fake: "shared-redis-connection" },
}));

vi.mock("../reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
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
  return {
    queueCtorCalls: [] as Array<{ name: string; opts: unknown }>,
    workerCtorCalls: [] as Array<{ name: string; processor: unknown; opts: unknown; instance: unknown }>,
    insertMock,
    insertValuesMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
    transactionMock,
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
  NotImplementedError,
  type QueueName,
} from "./registry";

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

  it("configures competitor-discovery per the stub: concurrency 3, 2 attempts, 5s fixed delay", () => {
    expect(QUEUE_CONFIG["competitor-discovery"]).toEqual({
      concurrency: 3,
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
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
  });

  function getRegisteredWorker() {
    const call = workerCtorCalls.find((c) => c.name === "competitor-discovery");
    if (!call) throw new Error("competitor-discovery worker was never registered");
    return call;
  }

  it("registers a real Worker for competitor-discovery via registerWorker at module load", () => {
    const call = getRegisteredWorker();
    expect(typeof call.processor).toBe("function");
    expect((call.opts as { concurrency: number }).concurrency).toBe(3);
  });

  it("short-circuits with a throw and does no work when the circuit is already open", async () => {
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;

    await expect(processor(fakeJob())).rejects.toThrow();
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("throws NotImplementedError and records a circuit-breaker failure when the circuit is closed", async () => {
    const processor = getRegisteredWorker().processor as (job: unknown) => Promise<void>;

    await expect(processor(fakeJob())).rejects.toThrow(NotImplementedError);
    expect(recordFailure).toHaveBeenCalledWith("competitor-discovery", expect.any(String));
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("writes exactly one competitor_discovery_log row and flips discovery_status to failed, atomically, once retries are exhausted", async () => {
    const worker = getRegisteredWorker().instance as import("node:events").EventEmitter;
    const job = fakeJob({ competitor_id: "comp-42", attemptsMade: 2, attempts: 2 });

    worker.emit("failed", job, new NotImplementedError("nope"), "active");
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
