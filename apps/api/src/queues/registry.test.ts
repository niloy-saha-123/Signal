import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/redis-client", () => ({
  redis: { __fake: "shared-redis-connection" },
}));

const { queueCtorCalls, workerCtorCalls } = vi.hoisted(() => ({
  queueCtorCalls: [] as Array<{ name: string; opts: unknown }>,
  workerCtorCalls: [] as Array<{ name: string; processor: unknown; opts: unknown }>,
}));

vi.mock("bullmq", () => {
  class Queue {
    name: string;
    opts: unknown;
    constructor(name: string, opts: unknown) {
      this.name = name;
      this.opts = opts;
      queueCtorCalls.push({ name, opts });
    }
  }
  class Worker {
    name: string;
    processor: unknown;
    opts: unknown;
    constructor(name: string, processor: unknown, opts: unknown) {
      this.name = name;
      this.processor = processor;
      this.opts = opts;
      workerCtorCalls.push({ name, processor, opts });
    }
  }
  return { Queue, Worker };
});

import { redis } from "../lib/redis-client";
import { connection, QUEUE_CONFIG, queues, registerWorker, type QueueName } from "./registry";

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
