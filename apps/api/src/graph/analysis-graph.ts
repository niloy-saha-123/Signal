// LangGraph.js DAG wiring the seven analysis nodes with parallel/sequential edges.
//
// Shape (see .superpowers/sdd/09-graph/task-4-brief.md and task-4-report.md for the empirical
// verification behind the original wiring, and .superpowers/sdd/10-analysis-agents/progress.md
// for the Part-10 correction described below):
//   START --> intentAnalyzer, sentimentClusterer, patternDetector, vulnerabilityDetector,
//             changeDetector
//            (5 unconditional parallel branches; each reads only competitor_id / its own DB
//            sources, none reads another node's output)
//   [intentAnalyzer, sentimentClusterer, patternDetector, vulnerabilityDetector, changeDetector]
//     --> synthesis
//            (addEdge(N[], target) fan-in — waits for ALL 5 listed sources, runs synthesis
//            exactly once)
//   synthesis --> comparativeSynthesis (only when is_own_company_run) --> forecaster --> END
//   synthesis --> forecaster --> END (normal competitor run)
//
// Why changeDetector is unconditional (changed in Part 10): the earlier wiring used
// `addConditionalEdges(START, has_pricing_diff ? "changeDetector" : "synthesis")`. That routed
// START directly to synthesis on the false path — which scheduled synthesisNode in superstep 1,
// in parallel with (not after) the other 4 branches, so synthesis read null for every branch
// output and persisted a meaningless Signal Score on the common daily (no-pricing-diff) path.
// The fix: changeDetector always runs and does the has_pricing_diff / empty-diffs skip check
// internally (returning {} without an LLM call), so the 5-way fan-in is always satisfiable and
// synthesis always runs exactly once, after all 5 branches, on every path.
import { StateGraph, START, END } from "@langchain/langgraph";
import { AnalysisGraphState } from "./state";
import { intentAnalyzerNode } from "../agents/analysis/intent-analyzer";
import { sentimentClustererNode } from "../agents/analysis/sentiment-clusterer";
import { changeDetectorNode } from "../agents/analysis/change-detector";
import { patternDetectorNode } from "../agents/analysis/pattern-detector";
import { vulnerabilityDetectorNode } from "../agents/analysis/vulnerability-detector";
import { synthesisNode } from "../agents/analysis/synthesis";
import { comparativeSynthesisNode } from "../agents/analysis/comparative-synthesis";
import { forecasterNode } from "../agents/analysis/forecaster";
import type { AnalysisGraphStateType } from "./state";

// synthesis → comparativeSynthesis only on an own-company run, else straight to the
// forecaster. The flag is caller-seeded (analysis-worker.ts) and read here, never
// re-queried inside the graph.
//
// The forecaster is the tail of both paths rather than a sixth parallel branch: it
// is the only node that needs the run's own conclusion, so running it alongside the
// branch nodes would have it forecasting without the decision and score in hand.
// Both paths converge on it through a single edge each, so one invocation forecasts
// exactly once — duplicating it would cost a model call and, worse, write a second
// row that later resolves separately and double-counts in the Brier score.
function afterSynthesis(state: AnalysisGraphStateType): "comparativeSynthesis" | "forecaster" {
  return state.is_own_company_run ? "comparativeSynthesis" : "forecaster";
}

const builder = new StateGraph(AnalysisGraphState)
  .addNode("intentAnalyzer", intentAnalyzerNode)
  .addNode("sentimentClusterer", sentimentClustererNode)
  .addNode("patternDetector", patternDetectorNode)
  .addNode("vulnerabilityDetector", vulnerabilityDetectorNode)
  .addNode("changeDetector", changeDetectorNode)
  .addNode("synthesis", synthesisNode)
  .addNode("comparativeSynthesis", comparativeSynthesisNode)
  .addNode("forecaster", forecasterNode)
  .addEdge(START, "intentAnalyzer")
  .addEdge(START, "sentimentClusterer")
  .addEdge(START, "patternDetector")
  .addEdge(START, "vulnerabilityDetector")
  .addEdge(START, "changeDetector")
  .addEdge(
    ["intentAnalyzer", "sentimentClusterer", "patternDetector", "vulnerabilityDetector", "changeDetector"],
    "synthesis"
  )
  .addConditionalEdges("synthesis", afterSynthesis, {
    comparativeSynthesis: "comparativeSynthesis",
    forecaster: "forecaster",
  })
  .addEdge("comparativeSynthesis", "forecaster")
  .addEdge("forecaster", END);

export const analysisGraph = builder.compile();
