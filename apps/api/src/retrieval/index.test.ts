import { describe, it, expect, vi } from "vitest";

// Hoist the mock definition so it's available to vi.mock
const { hybridRetrieveMock } = vi.hoisted(() => ({
  hybridRetrieveMock: vi.fn().mockResolvedValue([
    {
      id: "mocked-chunk",
      competitor_id: "c1",
      source: "reddit" as const,
      source_url: null,
      text: "mocked text",
      quality_score: 0.5,
      origin: "semantic" as const,
      rrf_score: 0.75,
    },
  ]),
}));

vi.mock("./hybrid-retrieval", () => ({
  hybridRetrieve: hybridRetrieveMock,
}));

// Import after mocking
import { hybridRetrieve, rerankChunks, enforceCitations, type RetrievedChunk, type RerankedChunk } from "./index";

describe("retrieval/index — barrel re-exports", () => {
  it("re-exports hybridRetrieve as a real pass-through to the underlying implementation", async () => {
    const result = await hybridRetrieve("test query", ["c1"]);

    expect(hybridRetrieveMock).toHaveBeenCalledWith("test query", ["c1"]);
    expect(result).toEqual([
      {
        id: "mocked-chunk",
        competitor_id: "c1",
        source: "reddit",
        source_url: null,
        text: "mocked text",
        quality_score: 0.5,
        origin: "semantic",
        rrf_score: 0.75,
      },
    ]);
  });

  it("exports rerankChunks as a function", () => {
    expect(typeof rerankChunks).toBe("function");
  });

  it("exports enforceCitations as a function", () => {
    expect(typeof enforceCitations).toBe("function");
  });

  it("exports RetrievedChunk type correctly", () => {
    // Runtime type check: RetrievedChunk should be a valid type that compiles.
    // At runtime, types are erased, so we verify the mock's return type matches the interface shape.
    const chunk: RetrievedChunk = {
      id: "s1",
      competitor_id: "c1",
      source: "reddit",
      source_url: null,
      text: "test",
      quality_score: 0.5,
      origin: "semantic",
      rrf_score: 0.75,
    };
    expect(chunk.id).toBe("s1");
  });

  it("exports RerankedChunk type correctly", () => {
    // RerankedChunk extends RetrievedChunk and adds relevance_score.
    const chunk: RerankedChunk = {
      id: "s1",
      competitor_id: "c1",
      source: "reddit",
      source_url: null,
      text: "test",
      quality_score: 0.5,
      origin: "semantic",
      rrf_score: 0.75,
      relevance_score: 0.85,
    };
    expect(chunk.relevance_score).toBe(0.85);
  });
});
