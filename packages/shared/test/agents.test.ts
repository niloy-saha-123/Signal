import { describe, it, expect } from "vitest";
import {
  CitationResultSchema,
  RefusalResultSchema,
  ChatAgentResultSchema,
  RagEvalResultSchema,
  RagEvalRunSummarySchema,
  LatencyRecordSchema,
  CitationSchema,
} from "../src/agents";

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

  it("rejects a positive answer without any verified citation", () => {
    expect(
      CitationResultSchema.safeParse({ refused: false, answer: "answer", citations: [] }).success
    ).toBe(false);
  });
});

describe("CitationSchema", () => {
  it("rejects a source outside the shared SignalSourceSchema enum", () => {
    const result = CitationSchema.safeParse({
      claim: "Acme raised prices 15% in August.",
      chunk_id: "chunk-1",
      source: "not_a_real_source",
      similarity_score: 0.9,
    });
    expect(result.success).toBe(false);
  });
});

describe("LatencyRecordSchema", () => {
  it("rejects an agent_name outside the CHECK constraint's allowed values", () => {
    const result = LatencyRecordSchema.safeParse({
      agent_name: "not_a_real_agent",
      p50: 100,
      p95: 200,
      p99: 300,
      mean: 150,
      sample_count: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe("RefusalResultSchema", () => {
  it("accepts a refusal with a suggested query", () => {
    const result = RefusalResultSchema.safeParse({
      refused: true,
      reason: "At least one claim was unsupported by retrieved chunks.",
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
      citations: [
        {
          claim: "answer",
          chunk_id: "chunk-1",
          source: "reddit",
          similarity_score: 0.9,
        },
      ],
    });
    expect(refusal.success).toBe(true);
    expect(citation.success).toBe(true);
  });
});

const CHUNK_ID = "660e8400-e29b-41d4-a716-446655440000";
const QUESTION_ID = "550e8400-e29b-41d4-a716-446655440000";
const validAnswer = {
  response_type: "answer" as const,
  question_id: QUESTION_ID,
  question: "What is Acme's pricing?",
  category: "pricing_history" as const,
  answer: "Acme offers Standard and Pro plans.",
  faithfulness_score: 0.85,
  passed: true,
  chunks_used: [CHUNK_ID],
  failure_code: "none" as const,
  reasoning: "grounded in retrieved pricing data",
};
const validRefusal = {
  response_type: "refusal" as const,
  question_id: QUESTION_ID,
  question: "What is Acme's pricing?",
  category: "pricing_history" as const,
  refusal_reason: "No evidence supported an answer.",
  faithfulness_score: 0,
  passed: false,
  chunks_used: [] as string[],
  failure_code: "unexpected_refusal" as const,
  reasoning: "ChatAgent returned a refusal for an answerable curated case",
};

describe("RagEvalResultSchema", () => {
  it("accepts a valid answer variant", () => {
    expect(RagEvalResultSchema.safeParse(validAnswer).success).toBe(true);
  });

  it("accepts a valid refusal variant", () => {
    expect(RagEvalResultSchema.safeParse(validRefusal).success).toBe(true);
  });

  it("rejects invalid question_id (not a UUID)", () => {
    const result = RagEvalResultSchema.safeParse({ ...validAnswer, question_id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects negative faithfulness_score", () => {
    const result = RagEvalResultSchema.safeParse({ ...validAnswer, faithfulness_score: -0.1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-finite faithfulness_score", () => {
    const result = RagEvalResultSchema.safeParse({ ...validAnswer, faithfulness_score: Infinity });
    expect(result.success).toBe(false);
  });

  it("rejects a refusal that also carries an answer field (unknown key, strict object)", () => {
    const result = RagEvalResultSchema.safeParse({ ...validRefusal, answer: "sneaking an answer in" });
    expect(result.success).toBe(false);
  });

  it("rejects an answer variant that also carries a refusal_reason (unknown key, strict object)", () => {
    const result = RagEvalResultSchema.safeParse({ ...validAnswer, refusal_reason: "not allowed here" });
    expect(result.success).toBe(false);
  });

  it("rejects a refusal with a non-empty chunks_used", () => {
    const result = RagEvalResultSchema.safeParse({ ...validRefusal, chunks_used: [CHUNK_ID] });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate chunk IDs", () => {
    const result = RagEvalResultSchema.safeParse({ ...validAnswer, chunks_used: [CHUNK_ID, CHUNK_ID] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 30 chunk IDs", () => {
    const chunks = Array.from({ length: 31 }, (_, index) =>
      `660e8400-e29b-41d4-a716-4466554${String(index).padStart(5, "0")}`
    );
    const result = RagEvalResultSchema.safeParse({ ...validAnswer, chunks_used: chunks });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized response_type", () => {
    const result = RagEvalResultSchema.safeParse({ ...validAnswer, response_type: "ambiguous" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty reasoning string", () => {
    const result = RagEvalResultSchema.safeParse({ ...validAnswer, reasoning: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized category", () => {
    const result = RagEvalResultSchema.safeParse({ ...validAnswer, category: "not_a_category" });
    expect(result.success).toBe(false);
  });
});

describe("RagEvalRunSummarySchema", () => {
  const validSummary = {
    run_at: "2026-01-01T00:00:00.000Z",
    total_questions: 10,
    passed: 9,
    failed: 1,
    faithfulness_score: 0.88,
    threshold: 0.8,
    ci_triggered: true,
    git_commit: "abc123",
  };

  it("accepts a summary whose passed + failed equals total_questions", () => {
    expect(RagEvalRunSummarySchema.safeParse(validSummary).success).toBe(true);
  });

  it("rejects invalid run_at (not a datetime)", () => {
    const result = RagEvalRunSummarySchema.safeParse({ ...validSummary, run_at: "not-a-datetime" });
    expect(result.success).toBe(false);
  });

  it("rejects a summary whose passed + failed does not equal total_questions", () => {
    const result = RagEvalRunSummarySchema.safeParse({ ...validSummary, passed: 5, failed: 1 });
    expect(result.success).toBe(false);
  });
});
