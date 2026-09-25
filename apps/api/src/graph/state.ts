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
// analysis-queue worker's BullMQ job id; `has_pricing_diff` is read directly by
// changeDetectorNode to decide whether it has any pricing work to do. As of this task, no
// part of this codebase owns that caller — the
// analysis-queue worker that will construct and seed this initial state does not exist yet.
// This is a known, disclosed open gap for whichever future part builds it, not something
// silently assumed solved here.
import { Annotation } from "@langchain/langgraph";
import type { SignalScore } from "@signal/shared";
import type { z } from "zod";
import type {
  AnalysisDecisionSchema,
  ComparativeSynthesisSchema,
  ForecastSchema,
} from "../agents/analysis/contracts";

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

// synthesis.ts: "combines all agent outputs into an alert/digest/suppress decision".
// Inferred (not hand-written) so this can never drift from AnalysisDecisionSchema, the actual
// LLM structured-output contract — including the optional `detail` alert-copy fields.
export type AnalysisDecision = z.infer<typeof AnalysisDecisionSchema>;

// comparative-synthesis.ts: "compares us against the workspace's real competitors".
// Inferred from ComparativeSynthesisSchema so it can never drift from that LLM contract.
export type ComparativeSynthesis = z.infer<typeof ComparativeSynthesisSchema>;

// forecaster.ts: "the dated, resolvable predictions this run actually stored".
// Only the ones that survived the duplicate gate and persisted appear here — the
// field reports what reached the ledger, not what the model proposed.
export type Forecast = z.infer<typeof ForecastSchema>;

// Overwrite-on-write reducer: a node's returned value simply replaces the prior one. Paired
// with `default` below to give these optional fields a defined initial value at invocation.
const overwrite = <T>(_left: T, right: T): T => right;

export const AnalysisGraphState = Annotation.Root({
  competitor_id: Annotation<string>,
  workspace_id: Annotation<string>(),
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
  // Comparative synthesis — the 7th node runs only for own-company monitoring and compares
  // "us" against the workspace's real competitors. Advisory output; null on a normal
  // competitor run (the node never fires) or when it short-circuits on no competitors.
  comparative_synthesis: Annotation<ComparativeSynthesis | null>({
    reducer: overwrite,
    default: () => null,
  }),
  // Caller-seeded (analysis-worker.ts), not computed by any node: whether the invoked
  // competitor_id is the workspace's own-company row. Drives the synthesis -> conditional
  // edge. Default false so a normal competitor run never reaches comparativeSynthesis.
  is_own_company_run: Annotation<boolean>({ reducer: overwrite, default: () => false }),
  // The predictions the forecaster actually wrote to the ledger this run. Empty is
  // the common, correct case: the node abstains below the evidence floor, when the
  // model declines, and when every proposed forecast duplicates an open one. An
  // empty array here means "ran, said nothing"; the node returns `{}` instead when
  // it failed or was skipped on budget, leaving the default in place.
  forecasts: Annotation<Forecast[]>({ reducer: overwrite, default: () => [] }),
});

export type AnalysisGraphStateType = typeof AnalysisGraphState.State;
