import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSignalByIdMock, createClusterForSignalPairMock, mergeSignalIntoClusterMock } =
  vi.hoisted(() => ({
    getSignalByIdMock: vi.fn(),
    createClusterForSignalPairMock: vi.fn(),
    mergeSignalIntoClusterMock: vi.fn(),
  }));

vi.mock("@/db/queries", () => ({
  getSignalById: getSignalByIdMock,
  createClusterForSignalPair: createClusterForSignalPairMock,
  mergeSignalIntoCluster: mergeSignalIntoClusterMock,
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

const { trackLatencyMock } = vi.hoisted(() => ({
  // Mirrors the real trackLatency's pass-through contract (same as
  // entity-extractor.test.ts) so the wrapped I/O still runs.
  trackLatencyMock: vi.fn(
    (_agentName: string, _competitorId: string, _runId: string, fn: () => unknown) => fn()
  ),
}));

vi.mock("@/lib/latency-tracker", () => ({ trackLatency: trackLatencyMock }));

const { embedTextMock } = vi.hoisted(() => ({
  embedTextMock: vi.fn(),
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: embedTextMock,
}));

const { pineconeQueryMock, pineconeUpsertMock } = vi.hoisted(() => ({
  pineconeQueryMock: vi.fn(),
  pineconeUpsertMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/vector/pinecone", () => ({
  pineconeQuery: pineconeQueryMock,
  pineconeUpsert: pineconeUpsertMock,
}));

const { registerWorkerMock } = vi.hoisted(() => ({
  registerWorkerMock: vi.fn(),
}));

vi.mock("@/queues/registry", () => ({
  registerWorker: registerWorkerMock,
}));

import {
  deduplicatorProcessor,
  initDeduplicatorWorker,
  buildEmbeddingText,
  DUPLICATE_THRESHOLD,
  DEDUP_TOP_K,
  CANONICAL_SUMMARY_MAX_LENGTH,
  EMBEDDING_TEXT_MAX_LENGTH,
} from "@/pipeline/deduplicator";

const baseSignal = {
  id: "s1",
  competitor_id: "c1",
  source: "reddit" as const,
  source_url: null,
  title: "Acme launches Widget Pro",
  raw_text: "Acme just launched Widget Pro for $99/month with SSO support.",
  quality_score: 0.5,
  entities: {},
  cluster_id: null,
  collected_at: new Date(),
  created_at: new Date(),
};

describe("pipeline/deduplicator — buildEmbeddingText", () => {
  it("concatenates title and raw_text with a blank line when both present", () => {
    expect(buildEmbeddingText({ title: "T", raw_text: "body" })).toBe("T\n\nbody");
  });

  it("falls back to raw_text alone when title is null", () => {
    expect(buildEmbeddingText({ title: null, raw_text: "body" })).toBe("body");
  });

  // Over 8192 tokens text-embedding-3-small returns a non-retryable 400, which would
  // burn every BullMQ attempt and leave the signal unindexed forever.
  it("caps the embedding input so an over-long body can't 400 permanently", () => {
    const text = buildEmbeddingText({ title: null, raw_text: "x".repeat(100_000) });

    expect(text).toHaveLength(EMBEDDING_TEXT_MAX_LENGTH);
    expect(EMBEDDING_TEXT_MAX_LENGTH).toBeLessThan(32_000);
  });
});

describe("pipeline/deduplicator — deduplicatorProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSignalByIdMock.mockResolvedValue(baseSignal);
    embedTextMock.mockResolvedValue([0.1, 0.2, 0.3]);
    pineconeUpsertMock.mockResolvedValue(undefined);
    pineconeQueryMock.mockResolvedValue([]);
    trackLatencyMock.mockImplementation(
      (_a: string, _c: string, _r: string, fn: () => unknown) => fn()
    );
    createClusterForSignalPairMock.mockResolvedValue({
      id: "cluster1",
      competitor_id: "c1",
      canonical_summary: "summary",
      contributing_sources: ["hn", "reddit"],
      corroboration_count: 2,
      first_seen_at: new Date(),
      last_updated: new Date(),
      created_at: new Date(),
    });
    mergeSignalIntoClusterMock.mockResolvedValue({
      id: "cluster1",
      competitor_id: "c1",
      canonical_summary: "summary",
      contributing_sources: ["hn", "reddit"],
      corroboration_count: 2,
      first_seen_at: new Date(),
      last_updated: new Date(),
      created_at: new Date(),
    });
  });

  it("returns early without embedding or upserting when the signal is not found", async () => {
    getSignalByIdMock.mockResolvedValue(undefined);

    await expect(
      deduplicatorProcessor({ id: "job1", data: { signal_id: "missing" } } as never)
    ).resolves.toBeUndefined();

    expect(embedTextMock).not.toHaveBeenCalled();
    expect(pineconeUpsertMock).not.toHaveBeenCalled();
    expect(pineconeQueryMock).not.toHaveBeenCalled();
  });

  it("embeds title+raw_text and upserts into Pinecone under the signal's own id", async () => {
    await deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(embedTextMock).toHaveBeenCalledWith(
      "Acme launches Widget Pro\n\nAcme just launched Widget Pro for $99/month with SSO support."
    );
    expect(pineconeUpsertMock).toHaveBeenCalledWith("c1", [
      { id: "s1", values: [0.1, 0.2, 0.3], metadata: { source: "reddit" } },
    ]);
  });

  it("queries Pinecone with the configured topK", async () => {
    await deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(pineconeQueryMock).toHaveBeenCalledWith("c1", [0.1, 0.2, 0.3], DEDUP_TOP_K);
  });

  it("leaves cluster_id null when no match clears the 0.88 threshold", async () => {
    pineconeQueryMock.mockResolvedValue([{ id: "other-signal", score: 0.5, metadata: {} }]);

    await deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(createClusterForSignalPairMock).not.toHaveBeenCalled();
    expect(mergeSignalIntoClusterMock).not.toHaveBeenCalled();
  });

  it("filters out the signal's own id even when it comes back as a perfect self-match", async () => {
    // The signal was just upserted in step 4, so Pinecone can return it as its own
    // top match at score 1.0 — this must never be treated as a duplicate of itself.
    pineconeQueryMock.mockResolvedValue([
      { id: "s1", score: 1.0, metadata: {} },
      { id: "other-signal", score: 0.5, metadata: {} },
    ]);

    await deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    // Neither the self-match (excluded by id) nor the 0.5 match (below threshold)
    // should produce a cluster.
    expect(getSignalByIdMock).toHaveBeenCalledTimes(1);
    expect(createClusterForSignalPairMock).not.toHaveBeenCalled();
  });

  it("joins the matched signal's existing cluster when it already has a cluster_id", async () => {
    pineconeQueryMock.mockResolvedValue([
      { id: "s1", score: 1.0, metadata: {} },
      { id: "matched1", score: 0.93, metadata: {} },
    ]);
    getSignalByIdMock.mockImplementation((id: string) => {
      if (id === "s1") return Promise.resolve(baseSignal);
      if (id === "matched1")
        return Promise.resolve({
          ...baseSignal,
          id: "matched1",
          source: "hn" as const,
          cluster_id: "existing-cluster",
        });
      return Promise.resolve(undefined);
    });

    await deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    // One atomic call — the cluster bump and this signal's cluster_id commit together.
    expect(mergeSignalIntoClusterMock).toHaveBeenCalledWith("existing-cluster", "s1", "reddit");
    expect(mergeSignalIntoClusterMock).toHaveBeenCalledTimes(1);
    expect(createClusterForSignalPairMock).not.toHaveBeenCalled();
  });

  it("creates a new cluster when the matched signal has no cluster_id yet, and clusters both signals", async () => {
    pineconeQueryMock.mockResolvedValue([{ id: "matched1", score: 0.95, metadata: {} }]);
    getSignalByIdMock.mockImplementation((id: string) => {
      if (id === "s1") return Promise.resolve(baseSignal);
      if (id === "matched1")
        return Promise.resolve({
          ...baseSignal,
          id: "matched1",
          source: "hn" as const,
          cluster_id: null,
          raw_text: "x".repeat(600),
        });
      return Promise.resolve(undefined);
    });

    await deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    // One atomic call, not create + merge + two updates — a partial failure across
    // those four writes was what let a retry orphan a cluster or double-count it.
    expect(createClusterForSignalPairMock).toHaveBeenCalledWith({
      competitor_id: "c1",
      canonical_summary: "x".repeat(CANONICAL_SUMMARY_MAX_LENGTH),
      matched_signal_id: "matched1",
      matched_source: "hn",
      new_signal_id: "s1",
      new_source: "reddit",
    });
    expect(mergeSignalIntoClusterMock).not.toHaveBeenCalled();
  });

  it("skips the merge without throwing when the matched id has no corresponding db row", async () => {
    pineconeQueryMock.mockResolvedValue([{ id: "ghost", score: 0.99, metadata: {} }]);
    getSignalByIdMock.mockImplementation((id: string) => {
      if (id === "s1") return Promise.resolve(baseSignal);
      return Promise.resolve(undefined);
    });

    await expect(
      deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never)
    ).resolves.toBeUndefined();

    expect(createClusterForSignalPairMock).not.toHaveBeenCalled();
    expect(mergeSignalIntoClusterMock).not.toHaveBeenCalled();
  });

  it("picks the highest-scoring match when multiple clear the threshold", async () => {
    pineconeQueryMock.mockResolvedValue([
      { id: "lower", score: 0.89, metadata: {} },
      { id: "higher", score: 0.97, metadata: {} },
    ]);
    getSignalByIdMock.mockImplementation((id: string) => {
      if (id === "s1") return Promise.resolve(baseSignal);
      if (id === "higher")
        return Promise.resolve({ ...baseSignal, id: "higher", source: "hn" as const, cluster_id: null });
      if (id === "lower")
        return Promise.resolve({ ...baseSignal, id: "lower", source: "jobs" as const, cluster_id: null });
      return Promise.resolve(undefined);
    });

    await deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(createClusterForSignalPairMock).toHaveBeenCalledWith(
      expect.objectContaining({ matched_signal_id: "higher", matched_source: "hn" })
    );
  });

  // pipeline-deduplication runs attempts: 3. A retry after a successful run would
  // otherwise re-embed, re-query and re-run the non-idempotent merge/create logic,
  // inflating corroboration_count — which feeds Signal Score.
  it("is a terminal no-op when cluster_id is already set by a previous attempt", async () => {
    getSignalByIdMock.mockResolvedValue({ ...baseSignal, cluster_id: "existing-cluster" });

    await expect(
      deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never)
    ).resolves.toBeUndefined();

    expect(embedTextMock).not.toHaveBeenCalled();
    expect(pineconeUpsertMock).not.toHaveBeenCalled();
    expect(pineconeQueryMock).not.toHaveBeenCalled();
    expect(mergeSignalIntoClusterMock).not.toHaveBeenCalled();
    expect(createClusterForSignalPairMock).not.toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("already clustered"),
      expect.objectContaining({ signal_id: "s1", cluster_id: "existing-cluster" })
    );
  });

  // OpenAI 400s on empty input — a permanent failure that would burn every attempt.
  it("skips embedding entirely when the signal has no embeddable text", async () => {
    getSignalByIdMock.mockResolvedValue({ ...baseSignal, title: null, raw_text: "   \n  " });

    await expect(
      deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never)
    ).resolves.toBeUndefined();

    expect(embedTextMock).not.toHaveBeenCalled();
    expect(pineconeUpsertMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("no embeddable text"),
      expect.objectContaining({ signal_id: "s1" })
    );
  });

  it("wraps the embed + Pinecone I/O in trackLatency under the deduplicator agent name", async () => {
    await deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(trackLatencyMock).toHaveBeenCalledWith(
      "deduplicator",
      "c1",
      "job1",
      expect.any(Function)
    );
  });

  it("falls back to the signal id as runId when job.id is missing", async () => {
    await deduplicatorProcessor({ id: undefined, data: { signal_id: "s1" } } as never);

    expect(trackLatencyMock).toHaveBeenCalledWith(
      "deduplicator",
      "c1",
      "s1",
      expect.any(Function)
    );
  });

  it("logs cluster_id and corroboration_count when a signal joins an existing cluster", async () => {
    pineconeQueryMock.mockResolvedValue([{ id: "matched1", score: 0.93, metadata: {} }]);
    getSignalByIdMock.mockImplementation((id: string) => {
      if (id === "s1") return Promise.resolve(baseSignal);
      if (id === "matched1")
        return Promise.resolve({ ...baseSignal, id: "matched1", cluster_id: "existing-cluster" });
      return Promise.resolve(undefined);
    });

    await deduplicatorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("joined an existing cluster"),
      expect.objectContaining({
        signal_id: "s1",
        cluster_id: "cluster1",
        corroboration_count: 2,
      })
    );
  });

  it("registers the pipeline-deduplication worker via initDeduplicatorWorker without registering at import time", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();

    initDeduplicatorWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith("pipeline-deduplication", deduplicatorProcessor);
  });
});

describe("pipeline/deduplicator — DUPLICATE_THRESHOLD", () => {
  it("is bound to 0.88 per signal_clusters' own schema comment", () => {
    expect(DUPLICATE_THRESHOLD).toBe(0.88);
  });
});
