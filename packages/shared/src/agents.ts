import { z } from "zod";
import { SignalSourceSchema } from "./signals";

// Mirrors agent_latencies's agent_name CHECK constraint in
// apps/api/drizzle/0000_nostalgic_the_enforcers.sql.
export const AgentNameSchema = z.enum([
  "intent_analyzer",
  "sentiment_clusterer",
  "change_detector",
  "pattern_detector",
  "vulnerability_detector",
  "synthesis",
  "chat_agent",
  "quality_scorer",
  "deduplicator",
  "entity_extractor",
  "comparative_synthesis",
]);
export type AgentName = z.infer<typeof AgentNameSchema>;

// Returned by retrieval/citation-enforcer.ts (retrieval/index.ts stage 3) when the
// every extracted factual claim is grounded in retrieved chunks.
export const CitationSchema = z.object({
  claim: z.string(),
  chunk_id: z.string(),
  source: SignalSourceSchema,
  similarity_score: z.number().min(0).max(1),
});
export type Citation = z.infer<typeof CitationSchema>;

export const CitationResultSchema = z.object({
  refused: z.literal(false),
  answer: z.string(),
  citations: z.array(CitationSchema).min(1),
});
export type CitationResult = z.infer<typeof CitationResultSchema>;

// Returned instead of CitationResult when any extracted claim is unsupported or no claims exist.
// Not an error — a valid, first-class ChatAgent output; callers must not treat it as one.
export const RefusalResultSchema = z.object({
  refused: z.literal(true),
  reason: z.string(),
  suggested_query: z.string(),
});
export type RefusalResult = z.infer<typeof RefusalResultSchema>;

// ChatAgent's full return type — discriminated on `refused`.
export const ChatAgentResultSchema = z.discriminatedUnion("refused", [
  CitationResultSchema,
  RefusalResultSchema,
]);
export type ChatAgentResult = z.infer<typeof ChatAgentResultSchema>;

// Shape returned by lib/latency-tracker.ts's computePercentiles() and consumed by
// scripts/latency-report.ts. Percentiles use the nearest-rank method.
export const LatencyRecordSchema = z.object({
  agent_name: AgentNameSchema,
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
  mean: z.number(),
  sample_count: z.number().int().min(0),
});
export type LatencyRecord = z.infer<typeof LatencyRecordSchema>;

// One row of scripts/rag-eval.ts output, stored in rag_eval_runs.results (jsonb).
// Discriminated on response_type: ChatAgent produced an answer (including a
// deterministic citation-integrity failure) or a typed refusal. A loose object with
// optional answer/refusal_reason could lie about which one actually happened.
export const RagEvalFailureCodeSchema = z.enum([
  "none",
  "unexpected_refusal",
  "citation_not_found",
  "citation_scope_violation",
  "citation_source_mismatch",
]);
export type RagEvalFailureCode = z.infer<typeof RagEvalFailureCodeSchema>;

const RagEvalChunkIdsSchema = z
  .array(z.string().uuid())
  .max(30)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Chunk IDs must be unique" });
    }
  });

// Single source of truth for the rag_eval_dataset category/confidence_level CHECK
// constraints (db/schema.ts) — db/queries.ts and scripts/seed-rag-eval.ts import
// these rather than re-declaring the same literal lists independently.
export const RagEvalCategorySchema = z.enum([
  "pricing_history",
  "hiring_pattern",
  "product_change",
  "sentiment_theme",
  "strategic_move",
  "general",
]);
export type RagEvalCategory = z.infer<typeof RagEvalCategorySchema>;

export const RagEvalConfidenceLevelSchema = z.enum(["high", "medium", "low"]);
export type RagEvalConfidenceLevel = z.infer<typeof RagEvalConfidenceLevelSchema>;

const RagEvalResultCommon = z.object({
  question_id: z.string().uuid(),
  question: z.string().min(1).max(2_000),
  category: RagEvalCategorySchema,
  faithfulness_score: z.number().finite().min(0).max(1),
  passed: z.boolean(),
  chunks_used: RagEvalChunkIdsSchema,
  failure_code: RagEvalFailureCodeSchema,
  reasoning: z.string().min(1).max(4_000),
});

export const RagEvalResultSchema = z.discriminatedUnion("response_type", [
  RagEvalResultCommon.extend({
    response_type: z.literal("answer"),
    answer: z.string().min(1).max(20_000),
  }).strict(),
  RagEvalResultCommon.extend({
    response_type: z.literal("refusal"),
    refusal_reason: z.string().min(1).max(2_000),
    chunks_used: z.tuple([]),
  }).strict(),
]);
export type RagEvalResult = z.infer<typeof RagEvalResultSchema>;

// Aggregate summary of one rag-eval.ts run — mirrors the rag_eval_runs table's own
// columns (not its jsonb `results`, which is RagEvalResult[]).
export const RagEvalRunSummarySchema = z
  .object({
    run_at: z.string().datetime(),
    total_questions: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    faithfulness_score: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1),
    ci_triggered: z.boolean(),
    git_commit: z.string().nullable().optional(),
  })
  .superRefine((summary, context) => {
    if (summary.passed + summary.failed !== summary.total_questions) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "passed + failed must equal total_questions",
        path: ["total_questions"],
      });
    }
  });
export type RagEvalRunSummary = z.infer<typeof RagEvalRunSummarySchema>;
