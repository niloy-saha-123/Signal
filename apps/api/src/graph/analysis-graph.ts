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
//   synthesis --> comparativeSynthesis (only when is_own_company_run) --> END
//   synthesis --> END (normal competitor run)
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
import type { AnalysisGraphStateType } from "./state";

// synthesis → comparativeSynthesis only on an own-company run, else straight to END. The flag
// is caller-seeded (analysis-worker.ts) and read here, never re-queried inside the graph.
function afterSynthesis(state: AnalysisGraphStateType): "comparativeSynthesis" | typeof END {
  return state.is_own_company_run ? "comparativeSynthesis" : END;
}

const builder = new StateGraph(AnalysisGraphState)
  .addNode("intentAnalyzer", intentAnalyzerNode)
  .addNode("sentimentClusterer", sentimentClustererNode)
  .addNode("patternDetector", patternDetectorNode)
  .addNode("vulnerabilityDetector", vulnerabilityDetectorNode)
  .addNode("changeDetector", changeDetectorNode)
  .addNode("synthesis", synthesisNode)
  .addNode("comparativeSynthesis", comparativeSynthesisNode)
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
    [END]: END,
  })
  .addEdge("comparativeSynthesis", END);

export const analysisGraph = builder.compile();
