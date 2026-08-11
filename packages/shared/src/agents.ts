// Zod schemas for agent input/output shapes shared across the LangGraph nodes.
//
// CitationResult — { refused: false, answer: string, citations: Array<{ claim, chunk_id, source,
//   similarity_score }> }. Returned by enforceCitations() when the response is sufficiently
//   grounded in retrieved chunks.
//
// RefusalResult — { refused: true, reason: string, suggested_query: string }. Returned by
//   enforceCitations() when > 40% of extracted claims are unsupported. Not an error — a valid,
//   first-class ChatAgent output.
//
// LatencyRecord — { agent_name, duration_ms, p50, p95, sample_count }. Shape returned by
//   lib/latency-tracker.ts computePercentiles() and consumed by scripts/latency-report.ts.
//
// RagEvalResult — { question_id, question, answer, faithfulness_score, passed, chunks_used:
//   string[], reasoning }. One row of scripts/rag-eval.ts output, stored in rag_eval_runs.results.
//
// RagEvalRunSummary — { run_at, total_questions, passed, failed, aggregate_faithfulness,
//   threshold, ci_triggered, git_commit }. Aggregate summary of one rag-eval.ts run.
export {};
