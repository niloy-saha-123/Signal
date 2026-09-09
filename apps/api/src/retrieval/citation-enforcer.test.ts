import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RerankedChunk } from "./reranker";

const { selectModelMock, getDailyBudgetMock } = vi.hoisted(() => ({
  selectModelMock: vi.fn().mockResolvedValue("gpt-4o-mini"),
  getDailyBudgetMock: vi.fn().mockReturnValue(2.0),
}));

vi.mock("../llm/adaptive-router", () => ({
  selectModel: selectModelMock,
  getDailyBudget: getDailyBudgetMock,
}));

const { trackCostMock, getDailySpendMock } = vi.hoisted(() => ({
  trackCostMock: vi.fn().mockResolvedValue(0),
  getDailySpendMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("../llm/cost-tracker", () => ({
  trackCost: trackCostMock,
  getDailySpend: getDailySpendMock,
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger", () => ({ logger: loggerMock }));

const { embedTextMock } = vi.hoisted(() => ({
  embedTextMock: vi.fn(),
}));

vi.mock("../lib/embeddings", () => ({ embedText: embedTextMock }));

// Same hoisted "real class as mock implementation" pattern as entity-extractor.test.ts —
// an arrow-function mockImplementation can't be `new`'d, which is exactly what
// citation-enforcer.ts does with ChatOpenAI.
const { invokeMock, withStructuredOutputMock, chatOpenAIMock } = vi.hoisted(() => {
  const invokeMock = vi.fn();
  const withStructuredOutputMock = vi.fn(() => ({ invoke: invokeMock }));
  class ChatOpenAIMockClass {
    withStructuredOutput = withStructuredOutputMock;
  }
  const chatOpenAIMock = vi.fn(ChatOpenAIMockClass);
  return { invokeMock, withStructuredOutputMock, chatOpenAIMock };
});

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: chatOpenAIMock,
}));

import { enforceCitations } from "./citation-enforcer";

function chunk(overrides: Partial<RerankedChunk> = {}): RerankedChunk {
  return {
    id: "chunk-1",
    competitor_id: "c1",
    source: "reddit",
    source_url: null,
    text: "default chunk text",
    quality_score: 0.8,
    origin: "both",
    rrf_score: 0.05,
    relevance_score: 0.9,
    ...overrides,
  };
}

function claimsResult(claims: string[], usage = { input_tokens: 10, output_tokens: 5 }) {
  return { raw: { usage_metadata: usage }, parsed: { claims } };
}

// Deterministic fake embedding vectors keyed by exact input text, so cosine similarity is
// computable and assertable in the test itself rather than a black box.
function mockVectors(vectors: Record<string, number[]>) {
  embedTextMock.mockImplementation((text: string) =>
    Promise.resolve(vectors[text] ?? [0, 0])
  );
}

describe("enforceCitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectModelMock.mockResolvedValue("gpt-4o-mini");
    getDailyBudgetMock.mockReturnValue(2.0);
    getDailySpendMock.mockResolvedValue(0);
    trackCostMock.mockResolvedValue(0);
  });

  it("returns all claims as citations with no caveat when every claim is fully supported (cosine 1.0)", async () => {
    invokeMock.mockResolvedValue(claimsResult(["Claim A", "Claim B"]));
    // Parallel unit vectors -> cosine similarity exactly 1.0, well above the 0.75 default.
    mockVectors({
      "Claim A": [1, 0],
      "Claim B": [0, 1],
      "Text A": [1, 0],
      "Text B": [0, 1],
    });
    const chunks = [
      chunk({ id: "c-a", source: "reddit", text: "Text A" }),
      chunk({ id: "c-b", source: "hn", text: "Text B" }),
    ];

    const result = await enforceCitations("The response text.", chunks, "some query");

    expect(result).toEqual({
      refused: false,
      answer: "The response text.",
      citations: [
        { claim: "Claim A", chunk_id: "c-a", source: "reddit", similarity_score: 1 },
        { claim: "Claim B", chunk_id: "c-b", source: "hn", similarity_score: 1 },
      ],
    });
    // O(claims) + O(chunks) = 2 + 2 = 4 embedText calls, never O(claims x chunks).
    expect(embedTextMock).toHaveBeenCalledTimes(4);
  });

  it("treats a claim at exactly the 0.75 threshold as supported (boundary is >=, not >)", async () => {
    invokeMock.mockResolvedValue(claimsResult(["Claim A"]));
    // Unit vectors with dot product 0.75 -> cosine similarity exactly 0.75.
    mockVectors({
      "Claim A": [1, 0],
      "Text A": [0.75, 0.6614378277661477], // sqrt(1 - 0.75^2), so |Text A| = 1
    });
    const chunks = [chunk({ id: "c-a", source: "hn", text: "Text A" })];

    const result = await enforceCitations("resp", chunks, "q");

    expect(result.refused).toBe(false);
    const citationResult = result as Extract<typeof result, { refused: false }>;
    expect(citationResult.citations).toEqual([
      { claim: "Claim A", chunk_id: "c-a", source: "hn", similarity_score: 0.75 },
    ]);
  });

  it("appends a caveat and includes only supported citations when unsupported ratio is exactly 40% (boundary is > not >=, so not refused)", async () => {
    invokeMock.mockResolvedValue(
      claimsResult(["Claim 1", "Claim 2", "Claim 3", "Claim 4", "Claim 5"])
    );
    const chunks = [chunk({ id: "match", text: "Match" }), chunk({ id: "nomatch", text: "NoMatch" })];

    // Claims 1-3 match "Match" (cosine 1.0, supported); Claims 4-5 are orthogonal to
    // "Match" and "NoMatch" is a zero-magnitude vector (exercises the cosineSimilarity
    // zero-magnitude guard) — so Claims 4-5 have no supporting chunk (unsupported).
    mockVectors({
      "Claim 1": [1, 0],
      "Claim 2": [1, 0],
      "Claim 3": [1, 0],
      "Claim 4": [0, 1],
      "Claim 5": [0, 1],
      Match: [1, 0],
      NoMatch: [0, 0], // zero-magnitude chunk vector — exercises the cosineSimilarity guard
    });

    const result = await enforceCitations("resp", chunks, "q");

    expect(result.refused).toBe(false);
    const citationResult = result as Extract<typeof result, { refused: false }>;
    expect(citationResult.answer).toBe(
      "resp\n\nNote: some details could not be verified against stored signals."
    );
    expect(citationResult.citations).toHaveLength(3);
    expect(citationResult.citations.map((c) => c.claim)).toEqual(["Claim 1", "Claim 2", "Claim 3"]);
  });

  it("refuses with a typed RefusalResult (not a thrown error) when unsupported ratio exceeds 40%", async () => {
    invokeMock.mockResolvedValue(
      claimsResult(["Claim 1", "Claim 2", "Claim 3", "Claim 4", "Claim 5"])
    );
    mockVectors({
      "Claim 1": [1, 0],
      "Claim 2": [1, 0],
      "Claim 3": [0, 1],
      "Claim 4": [0, 1],
      "Claim 5": [0, 1],
      Match: [1, 0],
    });
    const chunks = [chunk({ id: "match", text: "Match" })];

    const result = await enforceCitations("resp", chunks, "narrow this please");

    expect(result).toEqual({
      refused: true,
      reason: expect.stringContaining("3/5"),
      suggested_query: expect.any(String),
    });
    expect((result as { suggested_query: string }).suggested_query.length).toBeGreaterThan(0);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("refusing"),
      expect.objectContaining({
        query: "narrow this please",
        unsupported_count: 3,
        total_claims: 5,
      })
    );
  });

  it("treats zero extracted claims as fully supported, returning the original response unchanged with no citations", async () => {
    invokeMock.mockResolvedValue(claimsResult([]));
    const chunks = [chunk()];

    const result = await enforceCitations("The response text.", chunks, "q");

    expect(result).toEqual({ refused: false, answer: "The response text.", citations: [] });
    // No claims to compare against -> no embedding calls needed at all.
    expect(embedTextMock).not.toHaveBeenCalled();
  });

  it("skips the LLM entirely and degrades to zero claims (not a refusal) when the daily budget is exhausted", async () => {
    getDailyBudgetMock.mockReturnValue(2.0);
    getDailySpendMock.mockResolvedValue(2.0);
    const chunks = [chunk()];

    const result = await enforceCitations("The response text.", chunks, "q");

    expect(chatOpenAIMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(result).toEqual({ refused: false, answer: "The response text.", citations: [] });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("budget"),
      expect.objectContaining({ spend: 2.0, budget: 2.0 })
    );
  });

  it("resolves the model via selectModel and instantiates ChatOpenAI with bounded timeout/retries", async () => {
    invokeMock.mockResolvedValue(claimsResult([]));

    await enforceCitations("resp", [], "q");

    expect(selectModelMock).toHaveBeenCalledWith("gpt-4o-mini", true);
    expect(chatOpenAIMock).toHaveBeenCalledWith({
      model: "gpt-4o-mini",
      timeout: 30_000,
      maxRetries: 2,
    });
    expect(withStructuredOutputMock).toHaveBeenCalledWith(
      expect.any(Object),
      { includeRaw: true }
    );
  });

  it("tracks cost using the real token counts from usage_metadata, with undefined runId/competitor_id", async () => {
    invokeMock.mockResolvedValue(claimsResult([], { input_tokens: 123, output_tokens: 45 }));

    await enforceCitations("resp", [], "q");

    expect(trackCostMock).toHaveBeenCalledWith(
      "chat_agent",
      "gpt-4o-mini",
      123,
      45,
      undefined,
      undefined
    );
  });

  it("tracks cost with 0/0 tokens when usage_metadata is missing from the raw message", async () => {
    invokeMock.mockResolvedValue({ raw: {}, parsed: { claims: [] } });

    await enforceCitations("resp", [], "q");

    expect(trackCostMock).toHaveBeenCalledWith(
      "chat_agent",
      "gpt-4o-mini",
      0,
      0,
      undefined,
      undefined
    );
  });

  it("throws when structured output returns a null parse (schema validation failure), and logs it", async () => {
    invokeMock.mockResolvedValue({ raw: { usage_metadata: { input_tokens: 1, output_tokens: 1 } }, parsed: null });

    await expect(enforceCitations("resp", [], "q")).rejects.toThrow("schema validation");

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("schema validation"),
      expect.any(Object)
    );
  });

  it("treats a response with no chunks and at least one claim as fully unsupported, refusing", async () => {
    invokeMock.mockResolvedValue(claimsResult(["Claim A"]));
    mockVectors({ "Claim A": [1, 0] });

    const result = await enforceCitations("resp", [], "q");

    expect(result).toEqual({
      refused: true,
      reason: expect.stringContaining("1/1"),
      suggested_query: expect.any(String),
    });
  });
});
