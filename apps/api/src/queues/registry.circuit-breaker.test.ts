// Exercises the REAL circuit-breaker state machine (not the mocked
// isCircuitOpen/recordFailure used in registry.test.ts) against the
// competitor-discovery processor, per the Part 2 pattern in
// reliability/circuit-breaker.test.ts: mock only cacheRedis + db, import
// the real circuit-breaker module, and drive it through actual state
// transitions instead of asserting on a mocked interface.
import { describe, it, expect, vi } from "vitest";

// A tiny in-memory stand-in for the subset of ioredis commands
// circuit-breaker.ts actually issues (GET/SET with EX+NX/INCR/DEL) — real
// enough to drive its real state machine deterministically without hand
// -sequencing mockResolvedValueOnce() calls per assertion.
const fakeCacheRedis = vi.hoisted(() => {
  const store = new Map<string, { value: string; expiresAt?: number }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt < Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  };
  return {
    get: vi.fn(async (key: string) => live(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...rest: unknown[]) => {
      if (rest.includes("NX") && live(key) !== undefined) return null;
      const exIndex = rest.indexOf("EX");
      const ttlSeconds = exIndex >= 0 ? Number(rest[exIndex + 1]) : undefined;
      store.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined });
      return "OK";
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(live(key) ?? 0) + 1;
      store.set(key, { value: String(next) });
      return next;
    }),
    del: vi.fn(async (key: string) => {
      const existed = live(key) !== undefined;
      store.delete(key);
      return existed ? 1 : 0;
    }),
  };
});

vi.mock("../lib/redis-client", () => ({
  redis: { __fake: "shared-redis-connection" },
  cacheRedis: fakeCacheRedis,
}));

vi.mock("../db/client", () => ({
  db: { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) },
}));

vi.mock("../db/queries", () => ({
  getCompetitorById: vi.fn().mockResolvedValue({
    id: "comp-1",
    name: "Acme",
    domain: "acme.com",
    subreddits: [],
    greenhouse_token: null,
    lever_token: null,
    pricing_url: null,
    changelog_rss: null,
  }),
  updateDiscoveryStatus: vi.fn().mockResolvedValue(undefined),
  finalizeDiscovery: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../agents/discovery/competitor-discovery", () => ({
  discoverCompetitor: vi.fn().mockRejectedValue(new Error("discovery probe failed")),
}));

vi.mock("bullmq", () => {
  class Queue {
    constructor(
      public name: string,
      public opts: unknown
    ) {}
  }
  class Worker {
    processor: unknown;
    constructor(
      public name: string,
      processor: unknown,
      public opts: unknown
    ) {
      this.processor = processor;
    }
    on() {
      return this;
    }
  }
  return { Queue, Worker };
});

import { isCircuitOpen } from "../reliability/circuit-breaker";
import { initWorkers } from "./registry";

describe("competitor-discovery worker — real circuit breaker", () => {
  it("opens after 5 consecutive processor throws and short-circuits the next job", async () => {
    // Worker construction is gated behind initWorkers() (not a module-import side
    // effect anymore), so drive the real worker through it here.
    const { competitorDiscoveryWorker } = initWorkers();
    const processor = (competitorDiscoveryWorker as unknown as { processor: (job: unknown) => Promise<void> })
      .processor;
    const job = {
      data: {
        competitor_id: "00000000-0000-4000-8000-000000000001",
        name: "Acme",
        domain: "acme.com",
      },
    };

    for (let i = 0; i < 5; i++) {
      await expect(processor(job)).rejects.toThrow("discovery probe failed");
    }

    expect(await isCircuitOpen("competitor-discovery")).toBe(true);

    // 6th call short-circuits on the open check instead of reaching
    // runDiscovery — proven by the rejection changing from the probe error to
    // the circuit-open error.
    const err = await processor(job).catch((e) => e);
    expect(err).toEqual(new Error("competitor-discovery circuit is open — skipping job"));
  });
});
