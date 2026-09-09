import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockQuery = vi.fn();
const mockUpsert = vi.fn();
const mockNamespace = vi.fn().mockReturnValue({ query: mockQuery, upsert: mockUpsert });
const mockIndex = vi.fn().mockReturnValue({ namespace: mockNamespace });

vi.mock("@pinecone-database/pinecone", () => ({
  Pinecone: class {
    index() {
      return mockIndex();
    }
  },
}));

import { pineconeQuery, pineconeUpsert } from "./pinecone";

describe("pineconeQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ matches: [{ id: "chunk-1", score: 0.92, metadata: {} }] });
  });

  it("namespaces the query under the competitor id", async () => {
    await pineconeQuery("550e8400-e29b-41d4-a716-446655440000", [0.1, 0.2], 10);
    expect(mockNamespace).toHaveBeenCalledWith("550e8400-e29b-41d4-a716-446655440000");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ vector: [0.1, 0.2], topK: 10 })
    );
  });

  it("returns the matches from the Pinecone response", async () => {
    const result = await pineconeQuery("550e8400-e29b-41d4-a716-446655440000", [0.1, 0.2], 10);
    expect(result).toEqual([{ id: "chunk-1", score: 0.92, metadata: {} }]);
  });
});

describe("pineconeUpsert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue(undefined);
  });

  it("namespaces the upsert under the competitor id", async () => {
    await pineconeUpsert("550e8400-e29b-41d4-a716-446655440000", [
      { id: "chunk-1", values: [0.1, 0.2], metadata: { quality_score: 0.8 } },
    ]);
    expect(mockNamespace).toHaveBeenCalledWith("550e8400-e29b-41d4-a716-446655440000");
    expect(mockUpsert).toHaveBeenCalled();
  });
});
