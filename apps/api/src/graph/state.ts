// AnalysisGraphState — the shared state object threaded through the 6-node LangGraph analysis
// DAG (intentAnalyzer, sentimentClusterer, changeDetector, patternDetector,
// vulnerabilityDetector, synthesis). The DAG wiring (graph/analysis-graph.ts) and the node
// implementations (agents/analysis/*.ts) are later parts — this file only defines the schema.
//
// Immutability: this state is immutable. Every node returns a `Partial<AnalysisGraphState>`
// (LangGraph merges it via the annotation's reducer/overwrite behavior) — nodes never mutate
// `state` in place. This is a global LangGraph constraint for this project (see CLAUDE.md).
//
// Caller-seeded fields: `competitor_id`, `run_id`, and `has_pricing_diff` are set by the
// CALLER before `.invoke()`, not computed by any node in this graph. `run_id` is the future
// analysis-queue worker's BullMQ job id; `has_pricing_diff` is read by changeDetector's future
// conditional router. As of this task, no part of this codebase owns that caller — the
// analysis-queue worker that will construct and seed this initial state does not exist yet.
// This is a known, disclosed open gap for whichever future part builds it, not something
// silently assumed solved here.
import { Annotation } from "@langchain/langgraph";
import type { SignalScore } from "@signal/shared";

// intent-analyzer.ts: "infers competitor hiring intent from recent job postings".
export interface HiringIntentResult {
  summary: string;
  intent_level: "low" | "medium" | "high";
}

// sentiment-clusterer.ts: "clusters sentiment signals into new vs. chronic complaints".
export interface SentimentClustersResult {
  summary: string;
  new_complaints: string[];
  chronic_complaints: string[];
}

// change-detector.ts: "conditional pricing-change extraction, fires only when a diff is
// detected".
export interface PricingChangeResult {
  summary: string;
  old_price: string | null;
  new_price: string | null;
}

// pattern-detector.ts: "SQL volume aggregation plus GPT-4o trend synthesis over Pinecone
// signals".
export interface PatternsResult {
  summary: string;
  trend: "increasing" | "decreasing" | "stable";
}

// vulnerability-detector.ts: "identifies the vulnerability window and generates positioning
// copy".
export interface VulnerabilityResult {
  summary: string;
  window_open: boolean;
  positioning_copy: string;
}

// synthesis.ts: "combines all agent outputs into an alert/digest/suppress decision" — keep
// exactly these three literal values, the stub names no others.
export interface AnalysisDecision {
  action: "alert" | "digest" | "suppress";
  reason: string;
}

// Overwrite-on-write reducer: a node's returned value simply replaces the prior one. Paired
// with `default` below to give these optional fields a defined initial value at invocation.
const overwrite = <T>(_left: T, right: T): T => right;

export const AnalysisGraphState = Annotation.Root({
  competitor_id: Annotation<string>,
  run_id: Annotation<string>,
  has_pricing_diff: Annotation<boolean>({ reducer: overwrite, default: () => false }),
  hiring_intent: Annotation<HiringIntentResult | null>({ reducer: overwrite, default: () => null }),
  sentiment_clusters: Annotation<SentimentClustersResult | null>({
    reducer: overwrite,
    default: () => null,
  }),
  pricing_change: Annotation<PricingChangeResult | null>({ reducer: overwrite, default: () => null }),
  patterns: Annotation<PatternsResult | null>({ reducer: overwrite, default: () => null }),
  vulnerability: Annotation<VulnerabilityResult | null>({ reducer: overwrite, default: () => null }),
  signal_score: Annotation<SignalScore | null>({ reducer: overwrite, default: () => null }),
  decision: Annotation<AnalysisDecision | null>({ reducer: overwrite, default: () => null }),
});

export type AnalysisGraphStateType = typeof AnalysisGraphState.State;
