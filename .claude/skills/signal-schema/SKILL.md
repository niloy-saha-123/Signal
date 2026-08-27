---
name: signal-schema
description: >
  Signal database schema reference. Activate when writing Drizzle
  queries, migrations, or any code that touches the database.
  Contains table descriptions, column purposes, and relationship map.
---

# Signal Database Schema

`apps/api/src/db/schema.ts` is the real, implemented Drizzle schema (17
tables) — not stub comments. This skill summarizes it; treat `schema.ts`
itself as the source of truth for exact types/constraints/indexes.

## Table map
```
competitors              — entities being monitored. Only name + domain
                            come from the user; subreddits, greenhouse_token,
                            lever_token, pricing_url, changelog_rss are filled
                            in asynchronously by CompetitorDiscoveryAgent.
                            discovery_status (pending|in_progress|complete|
                            failed) + discovered_at track that fill-in.
signals                   — raw collected data (one row per signal). id
                            doubles as the Pinecone vector id.
signal_clusters           — deduplicated signal groups
pricing_baselines         — stored pricing page snapshots
pricing_diffs             — structured pricing change records
agent_runs                — one row per LangGraph graph execution
agent_latencies           — per-node timing for P50/P95 computation
prompt_versions           — versioned LLM prompts; exactly one active row
                            per agent_name enforced by a partial unique index
agent_test_cases          — labeled input/output pairs for eval
circuit_events            — circuit breaker state transitions (state itself
                            lives in Redis; this is the append-only log)
llm_costs                 — per-call token and cost tracking (numeric, not
                            real/float — money must not drift)
alerts                    — generated alerts with evidence chains
competitor_signal_scores  — Signal Score per competitor per day
company_profile           — single-row (single-tenant). Product description,
                            ICP, pricing tiers, differentiators, primary
                            competitor IDs. getCompanyContext()
                            (lib/company-context.ts) injects this into every
                            analysis/chat agent's system prompt.
competitor_discovery_log  — one row per field CompetitorDiscoveryAgent
                            attempted (subreddits|greenhouse|lever|
                            pricing_url|rss_url) — what URLs it tried, what
                            it found, found|not_found|error
rag_eval_dataset          — golden Q&A pairs for RAG evaluation
rag_eval_runs             — results of RAG evaluation script runs
```

## Key relationships
```
competitors (1) → signals (many)                              [CASCADE]
competitors (1) → signal_clusters (many)                       [CASCADE]
competitors (1) → pricing_baselines (many)                     [CASCADE]
competitors (1) → pricing_diffs (many)                         [CASCADE]
competitors (1) → agent_runs (many)                            [CASCADE]
competitors (1) → competitor_signal_scores (many)               [CASCADE]
competitors (1) → competitor_discovery_log (many)               [CASCADE]
competitors (1) → llm_costs (many, nullable)                    [SET NULL]
competitors (1) → rag_eval_dataset (many, nullable)             [SET NULL]
signals (many) → signal_clusters (1) via cluster_id             [SET NULL]
signal_clusters → alerts (many) via supporting_cluster_ids   [soft ref, no FK]
company_profile → competitors (many) via primary_competitor_ids [soft ref, no FK]
pricing_diffs (many) → pricing_baselines (1) via baseline_id    [RESTRICT]
agent_runs (1) → agent_latencies (many)                        [CASCADE]
agent_runs (1) → llm_costs (many, nullable)                     [SET NULL]
agent_runs (1) → alerts (many, nullable)                        [SET NULL]
prompt_versions (1) → agent_runs (many) via prompt_version_id   [RESTRICT]
```
CASCADE tables are meaningless without their competitor — pausing via
`competitors.is_active` is the everyday "stop tracking" path, so a hard
delete is already an explicit purge. RESTRICT/SET NULL protect audit and
financial records (see docs/decisions.md, 2026-08-27 schema entry, for the
full per-table reasoning).

## Tables worth reading the full shape of

### agent_latencies
Per-agent-node timing for every analysis graph run, for P50/P95 computation.
```
id UUID PK, run_id UUID (FK -> agent_runs.id, CASCADE), competitor_id UUID,
agent_name TEXT CHECK (intent_analyzer | sentiment_clusterer | change_detector |
  pattern_detector | vulnerability_detector | synthesis | chat_agent |
  quality_scorer | deduplicator | entity_extractor),
started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ nullable,
duration_ms INTEGER nullable (null for status='skipped'),
status TEXT CHECK (success | failed | skipped),
input_tokens INTEGER nullable, output_tokens INTEGER nullable,
model_used TEXT nullable, created_at TIMESTAMPTZ DEFAULT NOW()
```
Written by `lib/latency-tracker.ts` on every agent execution; read by
`scripts/latency-report.ts`.

### company_profile
Single-row for now (single-tenant). When multi-tenancy is added, add
`org_id` + a unique constraint on it — additive migration, not a rewrite.
```
id UUID PK,
product_description TEXT NOT NULL,
icp_company_size TEXT nullable, icp_industries TEXT[] DEFAULT '{}',
icp_buyer_role TEXT nullable,
pricing_tiers JSONB DEFAULT '[]' -- [{name, price, billing}]
key_differentiators TEXT[] DEFAULT '{}',
primary_competitor_ids UUID[] DEFAULT '{}' -- soft ref to competitors.id
created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
```
Read (and Redis-cached, `company:profile` key, 1h TTL) by
`getCompanyContext()` in `lib/company-context.ts`.

### competitor_discovery_log
```
id UUID PK, competitor_id UUID (FK -> competitors.id, CASCADE),
field_name TEXT CHECK (subreddits | greenhouse | lever | pricing_url | rss_url),
attempted_urls TEXT[] DEFAULT '{}', discovered_value TEXT nullable,
status TEXT CHECK (found | not_found | error), error_message TEXT nullable,
discovered_at TIMESTAMPTZ DEFAULT NOW()
```
Written by `agents/discovery/competitor-discovery.ts`, one row per field per
discovery run. Read by `GET /api/competitors/:id/discovery`.

### rag_eval_dataset
Golden evaluation dataset for ChatAgent RAG quality regression testing.
```
id UUID PK, question TEXT NOT NULL, expected_answer TEXT NOT NULL,
supporting_chunk_ids TEXT[] nullable, competitor_id UUID nullable (FK, SET NULL),
category TEXT CHECK (pricing_history | hiring_pattern | product_change |
  sentiment_theme | strategic_move | general),
confidence_level TEXT CHECK (high | medium | low),
created_at TIMESTAMPTZ DEFAULT NOW(), last_evaluated_at TIMESTAMPTZ nullable,
last_faithfulness_score FLOAT nullable
```
Seeded once via `scripts/seed-rag-eval.ts` (50 manually curated Q&A pairs) —
per CLAUDE.md, do not auto-generate or overwrite existing entries.

### rag_eval_runs
Results of each RAG evaluation run, for historical tracking and CI
regression gating.
```
id UUID PK, run_at TIMESTAMPTZ DEFAULT NOW(), total_questions INTEGER,
passed INTEGER, failed INTEGER, faithfulness_score FLOAT (0.0-1.0, aggregate),
threshold FLOAT (pass/fail threshold used), ci_triggered BOOLEAN DEFAULT FALSE,
git_commit TEXT nullable,
results JSONB (array of: question_id, score, answer, chunks_used, passed)
```
Written by `scripts/rag-eval.ts` on every CI run and manual invocation. Per
CLAUDE.md, `rag-eval.ts` is a CI gate — don't modify the faithfulness
threshold without updating the corresponding GitHub Actions env var.

### competitor_signal_scores
`competitor_id, score (0-100), components (JSONB), computed_at, delta_7d,
delta_30d` — recomputed daily by SynthesisAgent.

## Most-queried columns by agent

IntentAnalyzer:
```sql
SELECT * FROM signals
WHERE competitor_id = $1
AND source = 'jobs'
AND created_at >= NOW() - INTERVAL '7 days'
```

PatternDetector Phase 1 (volume counts, pure SQL — no LLM per CLAUDE.md):
```sql
SELECT DATE_TRUNC('day', created_at) as day,
       COUNT(*) as count,
       SUM(quality_score) as weighted_count
FROM signals
WHERE competitor_id = $1
AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY 1
```

SynthesisAgent (Signal Score):
```sql
SELECT * FROM competitor_signal_scores
WHERE competitor_id = $1
ORDER BY computed_at DESC LIMIT 30
```

Latency report:
```sql
SELECT agent_name,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) as p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95
FROM agent_latencies
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY agent_name
```

CompetitorDiscoveryAgent's own discovery log for one competitor:
```sql
SELECT * FROM competitor_discovery_log
WHERE competitor_id = $1
ORDER BY discovered_at
```
