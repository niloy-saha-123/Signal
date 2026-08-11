// Drizzle schema — competitors, signals, clusters, pricing_diffs, agent_runs, prompt_versions, costs, alerts.
// competitor_signal_scores: competitor_id, score (0-100), components (JSONB), computed_at, delta_7d, delta_30d.
//
// agent_latencies — per-agent-node timing for every analysis graph run, for P50/P95 computation.
//   id UUID PK, run_id UUID (FK -> agent_runs.id), competitor_id UUID,
//   agent_name TEXT (intent_analyzer | sentiment_clusterer | change_detector | pattern_detector |
//     vulnerability_detector | synthesis | chat_agent | quality_scorer | deduplicator | entity_extractor),
//   started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, duration_ms INTEGER (computed: completed - started),
//   status TEXT CHECK (success | failed | skipped), input_tokens INTEGER nullable,
//   output_tokens INTEGER nullable, model_used TEXT nullable, created_at TIMESTAMPTZ DEFAULT NOW().
//   Written by lib/latency-tracker.ts on every agent execution; read by scripts/latency-report.ts.
//
// rag_eval_dataset — golden evaluation dataset for ChatAgent RAG quality regression testing.
//   id UUID PK, question TEXT NOT NULL, expected_answer TEXT NOT NULL,
//   supporting_chunk_ids TEXT[] nullable, competitor_id UUID nullable,
//   category TEXT (pricing_history | hiring_pattern | product_change | sentiment_theme |
//     strategic_move | general),
//   confidence_level TEXT CHECK (high | medium | low), created_at TIMESTAMPTZ DEFAULT NOW(),
//   last_evaluated_at TIMESTAMPTZ nullable, last_faithfulness_score FLOAT nullable.
//   Seeded once via scripts/seed-rag-eval.ts (50 manually curated Q&A pairs) — not auto-generated.
//
// rag_eval_runs — results of each RAG evaluation run, for historical tracking and CI regression gating.
//   id UUID PK, run_at TIMESTAMPTZ DEFAULT NOW(), total_questions INTEGER, passed INTEGER,
//   failed INTEGER, faithfulness_score FLOAT (0.0-1.0, aggregate), threshold FLOAT (pass/fail
//   threshold used), ci_triggered BOOLEAN DEFAULT FALSE, git_commit TEXT nullable,
//   results JSONB (array of: question_id, score, answer, chunks_used, passed).
//   Written by scripts/rag-eval.ts on every CI run and manual invocation.
export {};
