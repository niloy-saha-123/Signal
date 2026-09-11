import { describe, it, expect, vi, beforeEach } from "vitest";

const { embedQueryMock, OpenAIEmbeddingsMock } = vi.hoisted(() => {
  const embedQueryMock = vi.fn();
  class OpenAIEmbeddingsMock {
    embedQuery = embedQueryMock;
  }
  return { embedQueryMock, OpenAIEmbeddingsMock: vi.fn(OpenAIEmbeddingsMock) };
});

vi.mock("@langchain/openai", () => ({
  OpenAIEmbeddings: OpenAIEmbeddingsMock,
}));

import { embedText } from "@/lib/embeddings";

describe("embedText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the embedding vector for the given text, using the text-embedding-3-small model", async () => {
    embedQueryMock.mockResolvedValue([0.1, 0.2, 0.3]);

    const result = await embedText("hello world");

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(embedQueryMock).toHaveBeenCalledWith("hello world");
    // The OpenAIEmbeddings client is a lazily-initialized module-level singleton
    // (matches vector/pinecone.ts's getIndex() pattern) — it's only constructed
    // once across this whole test file, on whichever test runs first, so the
    // constructor assertion has to live in this test.
    // Bounded explicitly rather than inheriting LangChain's defaults (openai-node's
    // 10-minute timeout × AsyncCaller's maxRetries: 6 ≈ 70 minutes on one worker slot).
    expect(OpenAIEmbeddingsMock).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      timeout: 15_000,
      maxRetries: 2,
    });
  });

  // Retry is the client's job now; a second withRetry layer on top multiplied the two.
  it("does not add a second retry layer on top of the client's own", async () => {
    embedQueryMock.mockRejectedValue(new Error("always fails"));

    await expect(embedText("never works")).rejects.toThrow("always fails");
    expect(embedQueryMock).toHaveBeenCalledTimes(1);
  });
});
