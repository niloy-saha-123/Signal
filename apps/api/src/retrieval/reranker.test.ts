import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import type { RetrievedChunk } from "./hybrid-retrieval";

const { rerankMock, cohereClientMock } = vi.hoisted(() => {
  const rerankMock = vi.fn();
  class CohereClientMockClass {
    rerank = rerankMock;
  }
  return { rerankMock, cohereClientMock: vi.fn(CohereClientMockClass) };
});

vi.mock("cohere-ai", () => ({ CohereClient: cohereClientMock }));

const { getMock, setexMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  setexMock: vi.fn(),
}));

vi.mock("../lib/redis-client", () => ({
  cacheRedis: { get: getMock, setex: setexMock },
}));

import { rerankChunks } from "./reranker";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: "s1",
    competitor_id: "c1",
    source: "reddit",
    source_url: null,
    text: "Acme launched Widget Pro",
    quality_score: 0.8,
    origin: "both",
    rrf_score: 0.05,
    ...overrides,
  };
}

function cacheKey(query: string, chunks: RetrievedChunk[]): string {
  const ids = chunks
    .map((c) => c.id)
    .sort()
    .join(",");
  return createHash("sha256").update(`${query}|${ids}`).digest("hex");
}

describe("rerankChunks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue(null);
    setexMock.mockResolvedValue("OK");
  });

  it("returns [] without calling Cohere when chunks is empty", async () => {
    const result = await rerankChunks("query", []);

    expect(result).toEqual([]);
    expect(getMock).not.toHaveBeenCalled();
    expect(cohereClientMock).not.toHaveBeenCalled();
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it("returns the cached value on a cache hit without calling Cohere", async () => {
    const cached = [{ ...chunk(), relevance_score: 0.9 }];
    getMock.mockResolvedValue(JSON.stringify(cached));

    const result = await rerankChunks("query", [chunk()]);

    expect(result).toEqual(cached);
    expect(cohereClientMock).not.toHaveBeenCalled();
    expect(rerankMock).not.toHaveBeenCalled();
    expect(setexMock).not.toHaveBeenCalled();
  });

  it("calls Cohere on a cache miss and writes the cache after", async () => {
    const chunks = [chunk({ id: "s1" }), chunk({ id: "s2" })];
    rerankMock.mockResolvedValue({
      results: [
        { index: 0, relevanceScore: 0.9 },
        { index: 1, relevanceScore: 0.8 },
      ],
    });

    const result = await rerankChunks("query", chunks);

    expect(rerankMock).toHaveBeenCalledWith({
      model: "rerank-english-v3.0",
      query: "query",
      documents: [{ text: chunks[0].text }, { text: chunks[1].text }],
      topN: 10,
    });
    expect(result).toEqual([
      { ...chunks[0], relevance_score: 0.9 },
      { ...chunks[1], relevance_score: 0.8 },
    ]);

    const expectedKey = cacheKey("query", chunks);
    expect(setexMock).toHaveBeenCalledWith(expectedKey, 7200, JSON.stringify(result));
    expect(getMock).toHaveBeenCalledWith(expectedKey);
  });

  it("remaps result.index back to the correct source chunk when Cohere reorders results", async () => {
    const chunks = [
      chunk({ id: "s1", text: "chunk zero" }),
      chunk({ id: "s2", text: "chunk one" }),
      chunk({ id: "s3", text: "chunk two" }),
    ];
    // Cohere returns results NOT in input order — index 2 ranked highest, then 0, then 1.
    rerankMock.mockResolvedValue({
      results: [
        { index: 2, relevanceScore: 0.95 },
        { index: 0, relevanceScore: 0.7 },
        { index: 1, relevanceScore: 0.5 },
      ],
    });

    const result = await rerankChunks("query", chunks);

    expect(result).toEqual([
      { ...chunks[2], relevance_score: 0.95 },
      { ...chunks[0], relevance_score: 0.7 },
      { ...chunks[1], relevance_score: 0.5 },
    ]);
  });

  it("filters out results below RERANKER_MIN_RELEVANCE_SCORE (default 0.4)", async () => {
    const chunks = [chunk({ id: "s1" }), chunk({ id: "s2" }), chunk({ id: "s3" })];
    rerankMock.mockResolvedValue({
      results: [
        { index: 0, relevanceScore: 0.9 },
        { index: 1, relevanceScore: 0.39 },
        { index: 2, relevanceScore: 0.4 },
      ],
    });

    const result = await rerankChunks("query", chunks);

    expect(result.map((c) => c.id)).toEqual(["s1", "s3"]);
  });

  it("respects a custom topK by passing it through as topN", async () => {
    const chunks = [chunk({ id: "s1" })];
    rerankMock.mockResolvedValue({ results: [{ index: 0, relevanceScore: 0.9 }] });

    await rerankChunks("query", chunks, 3);

    expect(rerankMock).toHaveBeenCalledWith(
      expect.objectContaining({ topN: 3 })
    );
  });
});
