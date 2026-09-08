import { describe, it, expect } from "vitest";
import { CitationResultSchema, RefusalResultSchema, ChatAgentResultSchema } from "./agents";

describe("CitationResultSchema", () => {
  it("accepts a grounded response with citations", () => {
    const result = CitationResultSchema.safeParse({
      refused: false,
      answer: "Acme raised prices 15% in August.",
      citations: [
        { claim: "Acme raised prices 15% in August.", chunk_id: "chunk-1", source: "pricing", similarity_score: 0.91 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("RefusalResultSchema", () => {
  it("accepts a refusal with a suggested query", () => {
    const result = RefusalResultSchema.safeParse({
      refused: true,
      reason: "Over 40% of claims were unsupported by retrieved chunks.",
      suggested_query: "Ask about a specific competitor and time window instead.",
    });
    expect(result.success).toBe(true);
  });
});

describe("ChatAgentResultSchema", () => {
  it("discriminates between CitationResult and RefusalResult on `refused`", () => {
    const refusal = ChatAgentResultSchema.safeParse({
      refused: true,
      reason: "no evidence",
      suggested_query: "try again",
    });
    const citation = ChatAgentResultSchema.safeParse({
      refused: false,
      answer: "answer",
      citations: [],
    });
    expect(refusal.success).toBe(true);
    expect(citation.success).toBe(true);
  });
});
