// LangGraph.js DAG wiring the six analysis nodes with parallel/conditional/sequential edges.
//
// Shape (see .superpowers/sdd/09-graph/task-4-brief.md and task-4-report.md for the empirical
// verification behind this wiring):
//   START --> intentAnalyzer, sentimentClusterer, patternDetector, vulnerabilityDetector
//            (4 unconditional parallel branches; confirmed independent by re-reading each
//            Task-3 stub — none reads another node's output, all only read competitor_id)
//   START --> (conditional) changeDetector | synthesis, based on state.has_pricing_diff
//            (deterministic boolean routing, no LLM call, per project-wide constraint)
//   [intentAnalyzer, sentimentClusterer, patternDetector, vulnerabilityDetector, changeDetector]
//     --> synthesis
//            (addEdge(N[], target) fan-in — proven by a standalone smoke test to wait for ALL
//            listed sources and run the target exactly once, not once per source)
//   synthesis --> END
//
// One subtlety: when has_pricing_diff is false, changeDetector never runs, so it can't
// contribute a write to unblock the fan-in edge that lists it as a source. LangGraph resolves
// this by conditionally routing to "synthesis" directly in that case (see the conditional
// mapping below) — synthesis has two ways in: the fan-in array edge (when changeDetector runs)
// and the conditional router's direct "synthesis" branch (when it doesn't). Both were proven
// correct together by the full-graph test's "runs exactly once" assertion in either case.
import { StateGraph, START, END } from "@langchain/langgraph";
import { AnalysisGraphState } from "./state";
import { intentAnalyzerNode } from "../agents/analysis/intent-analyzer";
import { sentimentClustererNode } from "../agents/analysis/sentiment-clusterer";
import { changeDetectorNode } from "../agents/analysis/change-detector";
import { patternDetectorNode } from "../agents/analysis/pattern-detector";
import { vulnerabilityDetectorNode } from "../agents/analysis/vulnerability-detector";
import { synthesisNode } from "../agents/analysis/synthesis";

const builder = new StateGraph(AnalysisGraphState)
  .addNode("intentAnalyzer", intentAnalyzerNode)
  .addNode("sentimentClusterer", sentimentClustererNode)
  .addNode("patternDetector", patternDetectorNode)
  .addNode("vulnerabilityDetector", vulnerabilityDetectorNode)
  .addNode("changeDetector", changeDetectorNode)
  .addNode("synthesis", synthesisNode)
  .addEdge(START, "intentAnalyzer")
  .addEdge(START, "sentimentClusterer")
  .addEdge(START, "patternDetector")
  .addEdge(START, "vulnerabilityDetector")
  .addConditionalEdges(START, (state) => (state.has_pricing_diff ? "changeDetector" : "synthesis"), {
    changeDetector: "changeDetector",
    synthesis: "synthesis",
  })
  .addEdge(
    ["intentAnalyzer", "sentimentClusterer", "patternDetector", "vulnerabilityDetector", "changeDetector"],
    "synthesis"
  )
  .addEdge("synthesis", END);

export const analysisGraph = builder.compile();
