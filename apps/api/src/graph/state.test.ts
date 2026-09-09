import { describe, it, expect } from "vitest";
import { StateGraph } from "@langchain/langgraph";
import { AnalysisGraphState } from "./state";

// Self-contained, throwaway single-node graph — does NOT import graph/analysis-graph.ts
// (Task 4, not built yet). This exists only to exercise Annotation default-value resolution
// at runtime, which is real LangGraph behavior, not just a TypeScript type.
describe("AnalysisGraphState", () => {
  it("resolves declared defaults for fields the caller doesn't seed", async () => {
    const graph = new StateGraph(AnalysisGraphState)
      .addNode("passthrough", (state) => state)
      .addEdge("__start__", "passthrough")
      .addEdge("passthrough", "__end__")
      .compile();

    const result = await graph.invoke({
      competitor_id: "competitor-1",
      run_id: "run-1",
    });

    expect(result.has_pricing_diff).toBe(false);
    expect(result.hiring_intent).toBeNull();
    expect(result.sentiment_clusters).toBeNull();
    expect(result.pricing_change).toBeNull();
    expect(result.patterns).toBeNull();
    expect(result.vulnerability).toBeNull();
    expect(result.signal_score).toBeNull();
    expect(result.decision).toBeNull();
    expect(result.competitor_id).toBe("competitor-1");
    expect(result.run_id).toBe("run-1");
  });

  it("lets a node overwrite a defaulted field via a partial return without mutating input", async () => {
    const graph = new StateGraph(AnalysisGraphState)
      .addNode("setPatterns", () => ({
        patterns: { summary: "trend detected", trend: "increasing" as const },
      }))
      .addEdge("__start__", "setPatterns")
      .addEdge("setPatterns", "__end__")
      .compile();

    const result = await graph.invoke({ competitor_id: "c1", run_id: "r1" });

    expect(result.patterns).toEqual({ summary: "trend detected", trend: "increasing" });
    // Untouched defaulted fields remain at their default.
    expect(result.vulnerability).toBeNull();
    expect(result.has_pricing_diff).toBe(false);
  });
});
