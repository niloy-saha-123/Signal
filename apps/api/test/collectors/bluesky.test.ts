import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  isCircuitMarkedOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));
const { listCompetitorsMock, existsMock, createSignalMock } = vi.hoisted(() => ({
  listCompetitorsMock: vi.fn(),
  existsMock: vi.fn(),
  createSignalMock: vi.fn(),
}));
vi.mock("@/db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  signalExistsBySourceUrl: existsMock,
  createSignal: createSignalMock,
}));
vi.mock("@/queues/registry", () => ({ registerWorker: vi.fn(), queues: {} }));
vi.mock("@/pipeline/recovery", () => ({ enqueueInitialSignalPipeline: vi.fn() }));
vi.mock("@/lib/retry", () => ({ withRetry: (fn: () => unknown) => fn() }));
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: safeFetchMock }));
const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: warnMock, error: vi.fn(), debug: vi.fn() },
}));

import { recordFailure, recordSuccess } from "@/reliability/circuit-breaker";
import { enqueueInitialSignalPipeline } from "@/pipeline/recovery";

import { blueskyCollectorProcessor } from "@/collectors/bluesky";

const job = {} as any;
const json = (body: unknown, status = 200) => ({
  status,
  headers: new Headers(),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function post(over: { handle?: string; text?: string; rkey?: string; reason?: unknown; createdAt?: string } = {}) {
  const { handle = "kestrel.bsky.social", text = "Shipped v2\nmore", rkey = "3kabc", reason, createdAt = "2026-09-30T00:00:00Z" } = over;
  return {
    ...(reason ? { reason } : {}),
    post: {
      uri: `at://did:plc:x/app.bsky.feed.post/${rkey}`,
      author: { handle },
      record: { text, createdAt },
    },
  };
}

describe("bluesky collector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsMock.mockResolvedValue(false);
    createSignalMock.mockImplementation(async (s: any) => ({ id: s.source_url }));
    listCompetitorsMock.mockResolvedValue([
      { id: "c1", name: "Kestrel", is_active: true, bluesky_handle: "kestrel.bsky.social" },
    ]);
  });

  it("does not fetch for a competitor without a handle", async () => {
    listCompetitorsMock.mockResolvedValue([{ id: "c1", name: "K", is_active: true, bluesky_handle: null }]);
    await blueskyCollectorProcessor(job);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("stores an original post", async () => {
    safeFetchMock.mockResolvedValue(json({ feed: [post()] }));
    await blueskyCollectorProcessor(job);
    expect(safeFetchMock.mock.calls[0][0]).toBe(
      "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=kestrel.bsky.social&limit=30&filter=posts_no_replies"
    );
    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(createSignalMock.mock.calls[0][0]).toMatchObject({
      competitor_id: "c1",
      source: "social",
      source_url: "https://bsky.app/profile/kestrel.bsky.social/post/3kabc",
      title: "Shipped v2",
      raw_text: "Bluesky post by @kestrel.bsky.social:\n\nShipped v2\nmore",
    });
    expect(enqueueInitialSignalPipeline).toHaveBeenCalledTimes(1);
  });

  it("skips reposts and posts by other authors", async () => {
    safeFetchMock.mockResolvedValue(
      json({ feed: [post({ reason: { $type: "repost" }, rkey: "r1" }), post({ handle: "other.bsky.social", rkey: "o1" })] })
    );
    await blueskyCollectorProcessor(job);
    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("dedupes an existing URL", async () => {
    safeFetchMock.mockResolvedValue(json({ feed: [post()] }));
    existsMock.mockResolvedValue(true);
    await blueskyCollectorProcessor(job);
    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("treats HTTP 400 as config: no signal, no circuit failure", async () => {
    safeFetchMock.mockResolvedValue(json({ error: "InvalidRequest" }, 400));
    await blueskyCollectorProcessor(job);
    expect(createSignalMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordSuccess).toHaveBeenCalledWith("bluesky");
  });

  it("charges the circuit on HTTP 503", async () => {
    safeFetchMock.mockResolvedValue(json({}, 503));
    await blueskyCollectorProcessor(job);
    expect(recordFailure).toHaveBeenCalledWith("bluesky", expect.any(String));
  });

  it("counts a committed signal even when its enqueue fails", async () => {
    safeFetchMock.mockResolvedValue(json({ feed: [post()] }));
    vi.mocked(enqueueInitialSignalPipeline).mockRejectedValueOnce(new Error("redis down"));
    await blueskyCollectorProcessor(job);
    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordSuccess).toHaveBeenCalledWith("bluesky");
  });
});
