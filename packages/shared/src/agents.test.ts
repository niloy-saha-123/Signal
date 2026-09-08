import { describe, it, expect } from "vitest";
import {
  CitationResultSchema,
  RefusalResultSchema,
  ChatAgentResultSchema,
  RagEvalResultSchema,
  RagEvalRunSummarySchema,
} from "./agents";

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

  it("rejects similarity_score outside 0-1 range", () => {
    const result = CitationResultSchema.safeParse({
      refused: false,
      answer: "Acme raised prices 15% in August.",
      citations: [
        { claim: "Acme raised prices 15% in August.", chunk_id: "chunk-1", source: "pricing", similarity_score: 1.5 },
      ],
    });
    expect(result.success).toBe(false);
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

describe("RagEvalResultSchema", () => {
  it("accepts a valid RAG evaluation result", () => {
    const result = RagEvalResultSchema.safeParse({
      question_id: "550e8400-e29b-41d4-a716-446655440000",
      question: "What is Acme's pricing?",
      answer: "Acme offers Standard and Pro plans.",
      faithfulness_score: 0.85,
      passed: true,
      chunks_used: ["chunk-1"],
      reasoning: "grounded in retrieved pricing data",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid question_id (not a UUID)", () => {
    const result = RagEvalResultSchema.safeParse({
      question_id: "not-a-uuid",
      question: "What is Acme's pricing?",
      answer: "Acme offers Standard and Pro plans.",
      faithfulness_score: 0.85,
      passed: true,
      chunks_used: ["chunk-1"],
      reasoning: "grounded in retrieved pricing data",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative faithfulness_score", () => {
    const result = RagEvalResultSchema.safeParse({
      question_id: "550e8400-e29b-41d4-a716-446655440000",
      question: "What is Acme's pricing?",
      answer: "Acme offers Standard and Pro plans.",
      faithfulness_score: -0.1,
      passed: true,
      chunks_used: ["chunk-1"],
      reasoning: "grounded in retrieved pricing data",
    });
    expect(result.success).toBe(false);
  });
});

describe("RagEvalRunSummarySchema", () => {
  it("rejects invalid run_at (not a datetime)", () => {
    const result = RagEvalRunSummarySchema.safeParse({
      run_at: "not-a-datetime",
      total_questions: 10,
      passed: 9,
      failed: 1,
      aggregate_faithfulness: 0.88,
      threshold: 0.8,
      ci_triggered: true,
      git_commit: "abc123",
    });
    expect(result.success).toBe(false);
  });
});
