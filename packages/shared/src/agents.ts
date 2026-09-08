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
]);
export type AgentName = z.infer<typeof AgentNameSchema>;

// Returned by retrieval/citation-enforcer.ts (retrieval/index.ts stage 3) when the
// generated response is sufficiently grounded in retrieved chunks (<=40% unsupported claims).
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
  citations: z.array(CitationSchema),
});
export type CitationResult = z.infer<typeof CitationResultSchema>;

// Returned instead of CitationResult when >40% of extracted claims are unsupported.
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
export const RagEvalResultSchema = z.object({
  question_id: z.string().uuid(),
  question: z.string(),
  answer: z.string(),
  faithfulness_score: z.number().min(0).max(1),
  passed: z.boolean(),
  chunks_used: z.array(z.string()),
  reasoning: z.string(),
});
export type RagEvalResult = z.infer<typeof RagEvalResultSchema>;

// Aggregate summary of one rag-eval.ts run — mirrors the rag_eval_runs table's own
// columns (not its jsonb `results`, which is RagEvalResult[]).
export const RagEvalRunSummarySchema = z.object({
  run_at: z.string().datetime(),
  total_questions: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  faithfulness_score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  ci_triggered: z.boolean(),
  git_commit: z.string().nullable().optional(),
});
export type RagEvalRunSummary = z.infer<typeof RagEvalRunSummarySchema>;
