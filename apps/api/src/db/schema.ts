// Drizzle schema — single-tenant (no RLS/tenant table yet; see docs/decisions.md).
// Money columns use `numeric`, never `real` — floats drift on repeated cost sums.
// Enum-shaped columns use a `text` + `check()` pair, not `pgEnum` — adding a value
// to a CHECK list is a one-line migration; adding one to a Postgres enum type is not.

import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  numeric,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── competitors ──────────────────────────────────────────────────────────
// Entities being monitored. One row per `POST /api/competitors` call — the
// user supplies only `name` and `domain`; every other field below
// (subreddits, greenhouse_token, lever_token, pricing_url, changelog_rss) is
// discovered after the fact by CompetitorDiscoveryAgent
// (agents/discovery/competitor-discovery.ts) and populated asynchronously.
// discovery_status tracks that background fill-in; the frontend polls
// GET /api/competitors/:id/discovery while it's pending/in_progress.
export const competitorsTable = pgTable(
  "competitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    domain: text("domain").notNull(),
    subreddits: text("subreddits").array().notNull().default(sql`'{}'::text[]`),
    greenhouse_token: text("greenhouse_token"),
    lever_token: text("lever_token"),
    pricing_url: text("pricing_url"),
    changelog_rss: text("changelog_rss"),
    // Pause monitoring without losing history — hard delete would orphan
    // every signal/alert/score row a RESTRICT/CASCADE choice below depends on.
    is_active: boolean("is_active").notNull().default(true),
    discovery_status: text("discovery_status").notNull().default("pending"),
    discovered_at: timestamp("discovered_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "competitors_discovery_status_check",
      sql`${table.discovery_status} IN ('pending', 'in_progress', 'complete', 'failed')`
    ),
    uniqueIndex("competitors_domain_idx").on(table.domain),
    index("competitors_is_active_idx").on(table.is_active),
  ]
);

// ── signals ──────────────────────────────────────────────────────────────
// Raw collected data, one row per signal, written by the 5 collectors after
// the quality/dedup/entity pipeline. The signal's own id doubles as its
// Pinecone vector id — no separate embedding_id column needed.
export const signalsTable = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitor_id: uuid("competitor_id")
      .notNull()
      .references(() => competitorsTable.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    source_url: text("source_url"),
    title: text("title"),
    raw_text: text("raw_text").notNull(),
    quality_score: real("quality_score").notNull().default(0),
    entities: jsonb("entities").$type<Record<string, unknown>>().default({}),
    cluster_id: uuid("cluster_id").references(() => signalClustersTable.id, {
      onDelete: "set null",
    }),
    collected_at: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "signals_source_check",
      sql`${table.source} IN ('reddit', 'hn', 'jobs', 'changelog', 'pricing')`
    ),
    check(
      "signals_quality_score_check",
      sql`${table.quality_score} >= 0 AND ${table.quality_score} <= 1`
    ),
    index("signals_competitor_id_idx").on(table.competitor_id),
    index("signals_created_at_idx").on(table.created_at),
    index("signals_quality_score_idx").on(table.quality_score),
    index("signals_cluster_id_idx").on(table.cluster_id),
    // IntentAnalyzer's exact query: competitor + source + 7-day window.
    index("signals_competitor_source_created_idx").on(
      table.competitor_id,
      table.source,
      table.created_at
    ),
  ]
);

// ── signal_clusters ──────────────────────────────────────────────────────
// Deduplicated signal groups. SemanticDeduplicator merges a new signal into
// an existing cluster (>=0.88 cosine similarity) instead of creating one.
export const signalClustersTable = pgTable(
  "signal_clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitor_id: uuid("competitor_id")
      .notNull()
      .references(() => competitorsTable.id, { onDelete: "cascade" }),
    canonical_summary: text("canonical_summary").notNull(),
    contributing_sources: text("contributing_sources")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    corroboration_count: integer("corroboration_count").notNull().default(1),
    first_seen_at: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    // Name matches the drizzle-orm skill's onConflictDoUpdate example.
    last_updated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("signal_clusters_competitor_id_idx").on(table.competitor_id),
    index("signal_clusters_competitor_last_updated_idx").on(
      table.competitor_id,
      table.last_updated
    ),
  ]
);

// ── pricing_baselines ────────────────────────────────────────────────────
// Stored pricing-page snapshots. PricingWatcherAgent diffs the latest
// snapshot against the prior one to produce a pricing_diffs row.
export const pricingBaselinesTable = pgTable(
  "pricing_baselines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitor_id: uuid("competitor_id")
      .notNull()
      .references(() => competitorsTable.id, { onDelete: "cascade" }),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    captured_at: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pricing_baselines_competitor_captured_idx").on(
      table.competitor_id,
      table.captured_at
    ),
  ]
);

// ── pricing_diffs ────────────────────────────────────────────────────────
// Structured pricing-change records. ChangeDetector reads these directly —
// never re-parses raw_text — and `significance: critical` skips the queue.
export const pricingDiffsTable = pgTable(
  "pricing_diffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitor_id: uuid("competitor_id")
      .notNull()
      .references(() => competitorsTable.id, { onDelete: "cascade" }),
    // A diff always compares against a specific baseline — that link must
    // not silently disappear, so RESTRICT rather than CASCADE/SET NULL.
    baseline_id: uuid("baseline_id")
      .notNull()
      .references(() => pricingBaselinesTable.id, { onDelete: "restrict" }),
    diff: jsonb("diff").$type<Record<string, unknown>>().notNull(),
    significance: text("significance").notNull(),
    detected_at: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "pricing_diffs_significance_check",
      sql`${table.significance} IN ('minor', 'moderate', 'critical')`
    ),
    index("pricing_diffs_competitor_detected_idx").on(table.competitor_id, table.detected_at),
    // Critical diffs bypass the weekly queue — this is the escalation lookup.
    index("pricing_diffs_critical_idx")
      .on(table.detected_at)
      .where(sql`${table.significance} = 'critical'`),
  ]
);

// ── agent_runs ───────────────────────────────────────────────────────────
// One row per LangGraph analysis-graph execution (not ChatAgent — that's
// real-time and doesn't run as a batch graph).
export const agentRunsTable = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitor_id: uuid("competitor_id")
      .notNull()
      .references(() => competitorsTable.id, { onDelete: "cascade" }),
    // Audit trail: which prompt version produced this run. Never disappear
    // out from under a run record, so RESTRICT.
    prompt_version_id: uuid("prompt_version_id").references(() => promptVersionsTable.id, {
      onDelete: "restrict",
    }),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("running"),
    outcome: text("outcome"),
    started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("agent_runs_trigger_check", sql`${table.trigger} IN ('scheduled', 'manual', 'backfill')`),
    check(
      "agent_runs_status_check",
      sql`${table.status} IN ('running', 'completed', 'failed')`
    ),
    check(
      "agent_runs_outcome_check",
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('alert', 'digest', 'suppress')`
    ),
    index("agent_runs_competitor_started_idx").on(table.competitor_id, table.started_at),
    index("agent_runs_status_idx").on(table.status),
  ]
);

// ── agent_latencies ──────────────────────────────────────────────────────
// Per-agent-node timing for every analysis graph run, for P50/P95
// computation. Written by lib/latency-tracker.ts; read by
// scripts/latency-report.ts. Pure telemetry, so CASCADE with its run.
export const agentLatenciesTable = pgTable(
  "agent_latencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    run_id: uuid("run_id")
      .notNull()
      .references(() => agentRunsTable.id, { onDelete: "cascade" }),
    competitor_id: uuid("competitor_id").notNull(),
    agent_name: text("agent_name").notNull(),
    started_at: timestamp("started_at", { withTimezone: true }).notNull(),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    // Nullable: a `skipped` node never completes, so has no duration.
    duration_ms: integer("duration_ms"),
    status: text("status").notNull(),
    input_tokens: integer("input_tokens"),
    output_tokens: integer("output_tokens"),
    model_used: text("model_used"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "agent_latencies_agent_name_check",
      sql`${table.agent_name} IN ('intent_analyzer', 'sentiment_clusterer', 'change_detector', 'pattern_detector', 'vulnerability_detector', 'synthesis', 'chat_agent', 'quality_scorer', 'deduplicator', 'entity_extractor')`
    ),
    check("agent_latencies_status_check", sql`${table.status} IN ('success', 'failed', 'skipped')`),
    index("agent_latencies_run_id_idx").on(table.run_id),
    // scripts/latency-report.ts: percentile duration per agent over 7 days.
    index("agent_latencies_agent_created_idx").on(table.agent_name, table.created_at),
  ]
);

// ── prompt_versions ──────────────────────────────────────────────────────
// Versioned LLM prompts. Promotion requires a z-test (scripts/promote.ts);
// exactly one active version per agent is a DB-enforced invariant below.
export const promptVersionsTable = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent_name: text("agent_name").notNull(),
    version: integer("version").notNull(),
    prompt_text: text("prompt_text").notNull(),
    is_active: boolean("is_active").notNull().default(false),
    accuracy: real("accuracy"),
    promoted_at: timestamp("promoted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("prompt_versions_agent_version_idx").on(table.agent_name, table.version),
    uniqueIndex("prompt_versions_one_active_per_agent_idx")
      .on(table.agent_name)
      .where(sql`${table.is_active} = true`),
  ]
);

// ── agent_test_cases ─────────────────────────────────────────────────────
// Labeled input/output pairs for prompt regression eval (scripts/eval.ts).
export const agentTestCasesTable = pgTable(
  "agent_test_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent_name: text("agent_name").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    expected_output: jsonb("expected_output").$type<Record<string, unknown>>().notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_test_cases_agent_name_idx").on(table.agent_name)]
);

// ── circuit_events ───────────────────────────────────────────────────────
// Append-only circuit-breaker transition log. Live state lives in Redis —
// this table exists so PatternDetector can flag/exclude trend-window gaps
// caused by an open-circuit period. Not scoped to a competitor: a circuit
// trips per external service, affecting every competitor's collection.
export const circuitEventsTable = pgTable(
  "circuit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    service: text("service").notNull(),
    state: text("state").notNull(),
    reason: text("reason"),
    occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("circuit_events_state_check", sql`${table.state} IN ('closed', 'open', 'half_open')`),
    index("circuit_events_service_occurred_idx").on(table.service, table.occurred_at),
  ]
);

// ── llm_costs ────────────────────────────────────────────────────────────
// Per-call token/cost tracking. Financial record — never CASCADE-deleted
// when its run or competitor is removed, only unlinked.
export const llmCostsTable = pgTable(
  "llm_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    run_id: uuid("run_id").references(() => agentRunsTable.id, { onDelete: "set null" }),
    competitor_id: uuid("competitor_id").references(() => competitorsTable.id, {
      onDelete: "set null",
    }),
    agent_name: text("agent_name").notNull(),
    model: text("model").notNull(),
    input_tokens: integer("input_tokens").notNull(),
    output_tokens: integer("output_tokens").notNull(),
    // NUMERIC, not real/float — repeated cost sums must not drift.
    cost_usd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("llm_costs_competitor_created_idx").on(table.competitor_id, table.created_at),
    index("llm_costs_agent_name_idx").on(table.agent_name),
  ]
);

// ── alerts ───────────────────────────────────────────────────────────────
// Generated alerts with evidence chains — the Sample Output block in the
// README is one row of this table, denormalized for display.
export const alertsTable = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitor_id: uuid("competitor_id")
      .notNull()
      .references(() => competitorsTable.id, { onDelete: "cascade" }),
    // Durable artifact — keep the alert even if its run is later purged.
    run_id: uuid("run_id").references(() => agentRunsTable.id, { onDelete: "set null" }),
    pattern: text("pattern").notNull(),
    confidence: real("confidence").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>[]>().notNull(),
    interpretation: text("interpretation").notNull(),
    vulnerability_window_days: integer("vulnerability_window_days"),
    recommended_actions: jsonb("recommended_actions").$type<Record<string, unknown>[]>().notNull(),
    // uuid[] can't carry a real FK constraint in Postgres — app-enforced.
    supporting_cluster_ids: uuid("supporting_cluster_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    delivered: boolean("delivered").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "alerts_confidence_check",
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`
    ),
    index("alerts_competitor_created_idx").on(table.competitor_id, table.created_at),
  ]
);

// ── competitor_signal_scores ─────────────────────────────────────────────
// Signal Score (0-100) per competitor, recomputed daily by SynthesisAgent.
export const competitorSignalScoresTable = pgTable(
  "competitor_signal_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitor_id: uuid("competitor_id")
      .notNull()
      .references(() => competitorsTable.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    components: jsonb("components").$type<Record<string, unknown>>().notNull(),
    delta_7d: real("delta_7d"),
    delta_30d: real("delta_30d"),
    computed_at: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("competitor_signal_scores_score_check", sql`${table.score} >= 0 AND ${table.score} <= 100`),
    // Exact query from the signal-schema skill: latest 30 scores for one competitor.
    index("competitor_signal_scores_competitor_computed_idx").on(
      table.competitor_id,
      table.computed_at
    ),
  ]
);

// ── company_profile ──────────────────────────────────────────────────────
// Single-row table for now (single-tenant). When multi-tenancy is added,
// add org_id and a unique constraint on org_id — this table's shape
// otherwise stays the same, so that migration is additive, not a rewrite.
// getCompanyContext() (lib/company-context.ts) reads this row and formats
// it into a system-prompt injection every analysis agent includes, so
// output is specific to the user's product instead of generic commentary.
export const companyProfileTable = pgTable("company_profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  // What the product does — the first line of every agent's injected context.
  product_description: text("product_description").notNull(),
  // Ideal-customer-profile fields — let agents judge whether a competitor's
  // affected users overlap with this company's actual target market.
  icp_company_size: text("icp_company_size"),
  icp_industries: text("icp_industries").array().notNull().default(sql`'{}'::text[]`),
  icp_buyer_role: text("icp_buyer_role"),
  // Array of { name, price, billing } — lets agents compute a direct price
  // delta against a competitor's pricing_diffs instead of speaking in generalities.
  pricing_tiers: jsonb("pricing_tiers").$type<Record<string, unknown>[]>().default(sql`'[]'::jsonb`),
  // 2-3 core strengths — the "why us" agents lean on when drafting positioning copy.
  key_differentiators: text("key_differentiators").array().notNull().default(sql`'{}'::text[]`),
  // Soft reference to competitors.id — no hard FK on array columns in
  // Postgres, so uniqueness/existence is enforced by the API layer, not the DB.
  primary_competitor_ids: uuid("primary_competitor_ids")
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── competitor_discovery_log ─────────────────────────────────────────────
// One row per field CompetitorDiscoveryAgent attempted to discover — what
// URLs it tried and what it found, so a 'failed' discovery is diagnosable
// (and manually fixable) instead of a silent gap in the competitors row.
export const competitorDiscoveryLogTable = pgTable(
  "competitor_discovery_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitor_id: uuid("competitor_id")
      .notNull()
      .references(() => competitorsTable.id, { onDelete: "cascade" }),
    field_name: text("field_name").notNull(),
    attempted_urls: text("attempted_urls").array().notNull().default(sql`'{}'::text[]`),
    discovered_value: text("discovered_value"),
    status: text("status").notNull(),
    error_message: text("error_message"),
    discovered_at: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "competitor_discovery_log_field_name_check",
      sql`${table.field_name} IN ('subreddits', 'greenhouse', 'lever', 'pricing_url', 'rss_url')`
    ),
    check(
      "competitor_discovery_log_status_check",
      sql`${table.status} IN ('found', 'not_found', 'error')`
    ),
    index("competitor_discovery_log_competitor_id_idx").on(table.competitor_id),
  ]
);

// ── rag_eval_dataset ─────────────────────────────────────────────────────
// Golden Q&A pairs for ChatAgent RAG regression testing. Seeded once via
// scripts/seed-rag-eval.ts — never auto-generated or overwritten.
export const ragEvalDatasetTable = pgTable(
  "rag_eval_dataset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    question: text("question").notNull(),
    expected_answer: text("expected_answer").notNull(),
    supporting_chunk_ids: text("supporting_chunk_ids").array(),
    competitor_id: uuid("competitor_id").references(() => competitorsTable.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull(),
    confidence_level: text("confidence_level").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    last_evaluated_at: timestamp("last_evaluated_at", { withTimezone: true }),
    last_faithfulness_score: real("last_faithfulness_score"),
  },
  (table) => [
    check(
      "rag_eval_dataset_category_check",
      sql`${table.category} IN ('pricing_history', 'hiring_pattern', 'product_change', 'sentiment_theme', 'strategic_move', 'general')`
    ),
    check(
      "rag_eval_dataset_confidence_level_check",
      sql`${table.confidence_level} IN ('high', 'medium', 'low')`
    ),
  ]
);

// ── rag_eval_runs ────────────────────────────────────────────────────────
// Results of each RAG eval run. scripts/rag-eval.ts is a CI gate — do not
// change the faithfulness threshold semantics without updating the GH
// Actions env var (see CLAUDE.md).
export const ragEvalRunsTable = pgTable("rag_eval_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  run_at: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  total_questions: integer("total_questions").notNull(),
  passed: integer("passed").notNull(),
  failed: integer("failed").notNull(),
  faithfulness_score: real("faithfulness_score").notNull(),
  threshold: real("threshold").notNull(),
  ci_triggered: boolean("ci_triggered").notNull().default(false),
  git_commit: text("git_commit"),
  results: jsonb("results").$type<Record<string, unknown>[]>().notNull(),
});
