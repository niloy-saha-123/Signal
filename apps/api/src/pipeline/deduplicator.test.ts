import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSignalByIdMock, updateSignalClusterMock, createSignalClusterMock, mergeSignalIntoClusterMock } =
  vi.hoisted(() => ({
    getSignalByIdMock: vi.fn(),
    updateSignalClusterMock: vi.fn().mockResolvedValue(undefined),
    createSignalClusterMock: vi.fn(),
    mergeSignalIntoClusterMock: vi.fn(),
  }));

vi.mock("../db/queries", () => ({
  getSignalById: getSignalByIdMock,
  updateSignalCluster: updateSignalClusterMock,
  createSignalCluster: createSignalClusterMock,
  mergeSignalIntoCluster: mergeSignalIntoClusterMock,
}));

const { embedTextMock } = vi.hoisted(() => ({
  embedTextMock: vi.fn(),
}));

vi.mock("../lib/embeddings", () => ({
  embedText: embedTextMock,
}));

const { pineconeQueryMock, pineconeUpsertMock } = vi.hoisted(() => ({
  pineconeQueryMock: vi.fn(),
  pineconeUpsertMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../vector/pinecone", () => ({
  pineconeQuery: pineconeQueryMock,
  pineconeUpsert: pineconeUpsertMock,
}));

const { registerWorkerMock } = vi.hoisted(() => ({
  registerWorkerMock: vi.fn(),
}));

vi.mock("../queues/registry", () => ({
  registerWorker: registerWorkerMock,
}));

import {
  deduplicatorProcessor,
  initDeduplicatorWorker,
  buildEmbeddingText,
  DUPLICATE_THRESHOLD,
  DEDUP_TOP_K,
  CANONICAL_SUMMARY_MAX_LENGTH,
} from "./deduplicator";

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
});

describe("pipeline/deduplicator — deduplicatorProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSignalByIdMock.mockResolvedValue(baseSignal);
    embedTextMock.mockResolvedValue([0.1, 0.2, 0.3]);
    pineconeUpsertMock.mockResolvedValue(undefined);
    pineconeQueryMock.mockResolvedValue([]);
    updateSignalClusterMock.mockResolvedValue(undefined);
    createSignalClusterMock.mockResolvedValue({
      id: "cluster1",
      competitor_id: "c1",
      canonical_summary: "summary",
      contributing_sources: ["hn"],
      corroboration_count: 1,
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

    expect(updateSignalClusterMock).not.toHaveBeenCalled();
    expect(createSignalClusterMock).not.toHaveBeenCalled();
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
    expect(updateSignalClusterMock).not.toHaveBeenCalled();
    expect(createSignalClusterMock).not.toHaveBeenCalled();
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

    expect(mergeSignalIntoClusterMock).toHaveBeenCalledWith("existing-cluster", "reddit");
    expect(createSignalClusterMock).not.toHaveBeenCalled();
    expect(updateSignalClusterMock).toHaveBeenCalledTimes(1);
    expect(updateSignalClusterMock).toHaveBeenCalledWith("s1", "existing-cluster");
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

    expect(createSignalClusterMock).toHaveBeenCalledWith({
      competitor_id: "c1",
      canonical_summary: "x".repeat(CANONICAL_SUMMARY_MAX_LENGTH),
      contributing_sources: ["hn"],
    });
    expect(mergeSignalIntoClusterMock).toHaveBeenCalledWith("cluster1", "reddit");
    expect(updateSignalClusterMock).toHaveBeenCalledWith("matched1", "cluster1");
    expect(updateSignalClusterMock).toHaveBeenCalledWith("s1", "cluster1");
    expect(updateSignalClusterMock).toHaveBeenCalledTimes(2);
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

    expect(updateSignalClusterMock).not.toHaveBeenCalled();
    expect(createSignalClusterMock).not.toHaveBeenCalled();
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

    expect(updateSignalClusterMock).toHaveBeenCalledWith("higher", "cluster1");
    expect(updateSignalClusterMock).not.toHaveBeenCalledWith("lower", expect.anything());
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
