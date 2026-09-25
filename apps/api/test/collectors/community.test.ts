import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));

const { listCompetitorsMock, cutoffMock, existsMock, createSignalMock, safeFetchMock } =
  vi.hoisted(() => ({
    listCompetitorsMock: vi.fn(),
    cutoffMock: vi.fn(),
    existsMock: vi.fn(),
    createSignalMock: vi.fn(),
    safeFetchMock: vi.fn(),
  }));

vi.mock("@/db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  getLatestSignalCollectedAt: cutoffMock,
  signalExistsBySourceUrl: existsMock,
  createSignal: createSignalMock,
}));
vi.mock("@/queues/registry", () => ({ registerWorker: vi.fn(), queues: {} }));
vi.mock("@/pipeline/recovery", () => ({ enqueueInitialSignalPipeline: vi.fn() }));
vi.mock("@/lib/retry", () => ({ withRetry: (fn: () => unknown) => fn() }));
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: safeFetchMock,
  assertPublicUrl: vi.fn().mockResolvedValue(undefined),
}));

import { communityCollectorProcessor } from "@/collectors/community";
import type { Job } from "bullmq";

const job = {} as Job<Record<string, never>>;

function topic(id: number, created_at: string) {
  return {
    id,
    title: `Migration pain ${id}`,
    slug: `migration-pain-${id}`,
    posts_count: 4,
    reply_count: 3,
    views: 120,
    created_at,
  };
}

function latest(topics: unknown[]) {
  return {
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify({ topic_list: { topics } }),
  };
}

describe("community collector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCompetitorsMock.mockResolvedValue([
      { id: "c1", name: "Kestrel", is_active: true, discourse_url: "https://forum.kestrel.dev" },
    ]);
    cutoffMock.mockResolvedValue(undefined);
    existsMock.mockResolvedValue(false);
    createSignalMock.mockResolvedValue({ id: "s1" });
  });

  it("turns each new forum topic into a community signal linked to the thread", async () => {
    safeFetchMock.mockResolvedValue(latest([topic(7, "2026-09-20T00:00:00Z")]));

    await communityCollectorProcessor(job);

    expect(safeFetchMock.mock.calls[0][0]).toBe("https://forum.kestrel.dev/latest.json");
    expect(createSignalMock).toHaveBeenCalledTimes(1);
    const [signal] = createSignalMock.mock.calls[0];
    expect(signal.source).toBe("community");
    expect(signal.source_url).toBe("https://forum.kestrel.dev/t/migration-pain-7/7");
  });

  it("skips topics created before the last collected signal", async () => {
    cutoffMock.mockResolvedValue(new Date("2026-09-10T00:00:00Z"));
    safeFetchMock.mockResolvedValue(
      latest([topic(1, "2026-09-01T00:00:00Z"), topic(2, "2026-09-15T00:00:00Z")])
    );

    await communityCollectorProcessor(job);

    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(createSignalMock.mock.calls[0][0].title).toBe("Migration pain 2");
  });

  it("does not store a thread twice", async () => {
    existsMock.mockResolvedValue(true);
    safeFetchMock.mockResolvedValue(latest([topic(7, "2026-09-20T00:00:00Z")]));

    await communityCollectorProcessor(job);

    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("never fetches for competitors without a forum", async () => {
    listCompetitorsMock.mockResolvedValue([
      { id: "c1", name: "Kestrel", is_active: true, discourse_url: null },
    ]);

    await communityCollectorProcessor(job);

    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});
