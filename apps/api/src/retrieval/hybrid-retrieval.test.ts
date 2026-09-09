import { describe, it, expect, vi, beforeEach } from "vitest";

const { embedTextMock } = vi.hoisted(() => ({
  embedTextMock: vi.fn(),
}));

vi.mock("../lib/embeddings", () => ({
  embedText: embedTextMock,
}));

const { pineconeQueryMock } = vi.hoisted(() => ({
  pineconeQueryMock: vi.fn(),
}));

vi.mock("../vector/pinecone", () => ({
  pineconeQuery: pineconeQueryMock,
}));

const { getRecentSignalsByCompetitorIdsMock, getSignalsByIdsMock } = vi.hoisted(() => ({
  getRecentSignalsByCompetitorIdsMock: vi.fn(),
  getSignalsByIdsMock: vi.fn(),
}));

vi.mock("../db/queries", () => ({
  getRecentSignalsByCompetitorIds: getRecentSignalsByCompetitorIdsMock,
  getSignalsByIds: getSignalsByIdsMock,
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger", () => ({ logger: loggerMock }));

import {
  hybridRetrieve,
  MIN_QUALITY_SCORE_FOR_RETRIEVAL,
  type RetrievedChunk,
} from "./hybrid-retrieval";
import type { Signal } from "../db/queries";

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "s1",
    competitor_id: "c1",
    source: "reddit",
    source_url: null,
    title: "Acme launches Widget Pro",
    raw_text: "Acme just launched Widget Pro for $99/month with SSO support.",
    quality_score: 0.5,
    entities: {},
    cluster_id: null,
    collected_at: new Date(),
    created_at: new Date(),
    ...overrides,
  } as Signal;
}

describe("retrieval/hybrid-retrieval — hybridRetrieve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embedTextMock.mockResolvedValue([0.1, 0.2, 0.3]);
    pineconeQueryMock.mockResolvedValue([]);
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue([]);
    getSignalsByIdsMock.mockResolvedValue([]);
  });

  it("returns [] without calling embedText when competitorIds is empty", async () => {
    const result = await hybridRetrieve("query", []);

    expect(result).toEqual([]);
    expect(embedTextMock).not.toHaveBeenCalled();
    expect(pineconeQueryMock).not.toHaveBeenCalled();
    expect(getRecentSignalsByCompetitorIdsMock).not.toHaveBeenCalled();
  });

  it("returns [] without throwing when neither side has any results", async () => {
    const result = await hybridRetrieve("query", ["c1"]);

    expect(result).toEqual([]);
  });

  it("queries Pinecone once per competitorId (fan-out), namespaced correctly", async () => {
    embedTextMock.mockResolvedValue([0.9, 0.9]);

    await hybridRetrieve("query", ["c1", "c2", "c3"]);

    expect(pineconeQueryMock).toHaveBeenCalledTimes(3);
    expect(pineconeQueryMock).toHaveBeenCalledWith("c1", [0.9, 0.9], 20);
    expect(pineconeQueryMock).toHaveBeenCalledWith("c2", [0.9, 0.9], 20);
    expect(pineconeQueryMock).toHaveBeenCalledWith("c3", [0.9, 0.9], 20);
  });

  it("reuses embedText's single call for the query embedding across every competitor fan-out", async () => {
    await hybridRetrieve("query", ["c1", "c2"]);

    expect(embedTextMock).toHaveBeenCalledTimes(1);
    expect(embedTextMock).toHaveBeenCalledWith("query");
  });

  it("ranks an id found in BOTH lists above an id ranked #1 in only one list (RRF, not plumbing)", async () => {
    // bm25 corpus has exactly one document ("both"), so its bm25 rank is
    // deterministically 1 regardless of flexsearch's internal tie-breaking.
    // Semantic list ranks "semantic-only" #1 and "both" #2.
    //   both:          bm25 rank 1 + semantic rank 2 -> 1/61 + 1/62 ≈ 0.032523
    //   semantic-only: semantic rank 1 only           -> 1/61        ≈ 0.016393
    // Even though semantic-only is the #1 ranked result on its own list, an id
    // appearing on both lists must still outrank it once fused.
    const both = makeSignal({ id: "both", title: null, raw_text: "widget pro launch pricing" });
    const semanticOnly = makeSignal({ id: "semantic-only", raw_text: "unrelated text" });

    getRecentSignalsByCompetitorIdsMock.mockResolvedValue([both]);
    pineconeQueryMock.mockResolvedValue([
      { id: "semantic-only", score: 0.99, metadata: {} },
      { id: "both", score: 0.5, metadata: {} },
    ]);
    getSignalsByIdsMock.mockResolvedValue([semanticOnly]);

    const result = await hybridRetrieve("widget pro launch pricing", ["c1"]);

    const bothChunk = result.find((c) => c.id === "both");
    const semanticOnlyChunk = result.find((c) => c.id === "semantic-only");

    expect(bothChunk).toBeDefined();
    expect(semanticOnlyChunk).toBeDefined();
    expect(bothChunk!.origin).toBe("both");
    expect(semanticOnlyChunk!.origin).toBe("semantic");
    expect(bothChunk!.rrf_score).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(semanticOnlyChunk!.rrf_score).toBeCloseTo(1 / 61, 10);
    expect(bothChunk!.rrf_score).toBeGreaterThan(semanticOnlyChunk!.rrf_score);
    expect(result.indexOf(bothChunk!)).toBeLessThan(result.indexOf(semanticOnlyChunk!));
  });

  it("computes rrf_score with the exact RRF formula sum(1/(60+rank))", async () => {
    const signal = makeSignal({ id: "s1", raw_text: "only match" });
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue([signal]);
    // Semantic: only match returned -> rank 1
    pineconeQueryMock.mockResolvedValue([{ id: "s1", score: 0.8, metadata: {} }]);

    const result = await hybridRetrieve("only match", ["c1"]);

    const chunk = result.find((c) => c.id === "s1")!;
    // bm25 rank 1 (only doc in corpus, matches query) + semantic rank 1
    const expected = 1 / (60 + 1) + 1 / (60 + 1);
    expect(chunk.rrf_score).toBeCloseTo(expected, 10);
    expect(chunk.origin).toBe("both");
  });

  it("drops chunks below MIN_QUALITY_SCORE_FOR_RETRIEVAL instead of clamping them up", async () => {
    const lowQuality = makeSignal({ id: "low", quality_score: 0.05, raw_text: "low quality text" });
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue([lowQuality]);
    pineconeQueryMock.mockResolvedValue([]);

    const result = await hybridRetrieve("low quality text", ["c1"]);

    expect(result).toEqual([]);
  });

  it("keeps chunks at or above the quality floor", async () => {
    const atFloor = makeSignal({
      id: "at-floor",
      quality_score: MIN_QUALITY_SCORE_FOR_RETRIEVAL,
      raw_text: "at floor text",
    });
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue([atFloor]);
    pineconeQueryMock.mockResolvedValue([]);

    const result = await hybridRetrieve("at floor text", ["c1"]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("at-floor");
  });

  it("hydrates semantic-only ids via getSignalsByIds instead of refetching bm25-side ids", async () => {
    const semanticOnly = makeSignal({ id: "sem-only", competitor_id: "c1", source: "hn" });
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue([]);
    pineconeQueryMock.mockResolvedValue([{ id: "sem-only", score: 0.7, metadata: {} }]);
    getSignalsByIdsMock.mockResolvedValue([semanticOnly]);

    const result = await hybridRetrieve("query", ["c1"]);

    expect(getSignalsByIdsMock).toHaveBeenCalledWith(["sem-only"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject<Partial<RetrievedChunk>>({
      id: "sem-only",
      competitor_id: "c1",
      source: "hn",
      origin: "semantic",
    });
  });

  it("does not refetch ids that already came from the bm25 corpus fetch", async () => {
    const bothSignal = makeSignal({ id: "both-id", raw_text: "shared corpus text" });
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue([bothSignal]);
    pineconeQueryMock.mockResolvedValue([{ id: "both-id", score: 0.6, metadata: {} }]);

    await hybridRetrieve("shared corpus text", ["c1"]);

    expect(getSignalsByIdsMock).not.toHaveBeenCalled();
  });

  it("skips ids with no corresponding db row anywhere instead of throwing", async () => {
    pineconeQueryMock.mockResolvedValue([{ id: "ghost", score: 0.9, metadata: {} }]);
    getSignalsByIdsMock.mockResolvedValue([]); // ghost id has no row

    const result = await hybridRetrieve("query", ["c1"]);

    expect(result).toEqual([]);
  });

  it("sorts by rrf_score desc and slices to topK", async () => {
    // Only "a"'s text contains the query term, so bm25 deterministically returns
    // just "a" at rank 1 — b/c/d's relative ordering never depends on flexsearch
    // internals since they don't match the query at all.
    const signals = [
      makeSignal({ id: "a", title: null, raw_text: "uniqueaword" }),
      makeSignal({ id: "b", title: null, raw_text: "unrelated" }),
      makeSignal({ id: "c", title: null, raw_text: "unrelated" }),
      makeSignal({ id: "d", title: null, raw_text: "unrelated" }),
    ];
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue(signals);
    // Semantic ranks: a=1, b=2, c=3, d=4 (best score first)
    pineconeQueryMock.mockResolvedValue([
      { id: "a", score: 0.9, metadata: {} },
      { id: "b", score: 0.8, metadata: {} },
      { id: "c", score: 0.7, metadata: {} },
      { id: "d", score: 0.6, metadata: {} },
    ]);

    const result = await hybridRetrieve("uniqueaword", ["c1"], 2);

    expect(result).toHaveLength(2);
    expect(result[0].rrf_score).toBeGreaterThanOrEqual(result[1].rrf_score);
    // "a": bm25 rank1 + semantic rank1; "b": semantic rank2 only -> a > b > c > d.
    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("isolates a per-competitor pineconeQuery rejection — surviving competitors' matches still come back", async () => {
    const survivor = makeSignal({ id: "survivor", competitor_id: "c2", source: "hn" });
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue([]);
    getSignalsByIdsMock.mockResolvedValue([survivor]);
    pineconeQueryMock.mockImplementation((competitorId: string) => {
      if (competitorId === "c1") return Promise.reject(new Error("Pinecone namespace error"));
      return Promise.resolve([{ id: "survivor", score: 0.8, metadata: {} }]);
    });

    const result = await hybridRetrieve("query", ["c1", "c2"]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("survivor");
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("pineconeQuery failed"),
      expect.objectContaining({ competitor_id: "c1" })
    );
  });

  it("returns [] instead of throwing when every competitor's pineconeQuery rejects, BM25 side still applies", async () => {
    pineconeQueryMock.mockRejectedValue(new Error("Pinecone outage"));
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue([]);

    const result = await hybridRetrieve("query", ["c1", "c2"]);

    expect(result).toEqual([]);
    expect(loggerMock.warn).toHaveBeenCalledTimes(2);
  });

  it("uses HYBRID_RETRIEVAL_TOP_K as the default topK when not passed explicitly", async () => {
    embedTextMock.mockResolvedValue([1]);

    await hybridRetrieve("query", ["c1"]);

    expect(pineconeQueryMock).toHaveBeenCalledWith("c1", [1], 20);
  });
});
