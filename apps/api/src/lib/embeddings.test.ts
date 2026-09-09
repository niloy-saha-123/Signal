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

import { embedText } from "./embeddings";

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
    // once across this whole test file, on whichever test runs first.
    expect(OpenAIEmbeddingsMock).toHaveBeenCalledWith({ model: "text-embedding-3-small" });
  });

  it("retries on a transient failure and succeeds on a later attempt", async () => {
    embedQueryMock
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce([0.5, 0.6]);

    const result = await embedText("retry me");

    expect(result).toEqual([0.5, 0.6]);
    expect(embedQueryMock).toHaveBeenCalledTimes(2);
  }, 10000);

  it("throws after exhausting retries on a persistent failure", async () => {
    embedQueryMock.mockRejectedValue(new Error("always fails"));

    await expect(embedText("never works")).rejects.toThrow("always fails");
    expect(embedQueryMock).toHaveBeenCalledTimes(3);
  }, 10000);
});
