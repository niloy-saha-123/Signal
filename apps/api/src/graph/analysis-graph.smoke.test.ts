// Standalone smoke test for the LangGraph.js fan-in mechanism the real analysis-graph.ts
// relies on. Throwaway state schema — no dependency on AnalysisGraphState or the real nodes.
// (A second block here once proved START-with-unconditional-plus-conditional-edges routing;
// removed when Part 10 dropped the conditional edge — see analysis-graph.ts for why.)
import { describe, it, expect } from "vitest";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";

const overwrite = <T>(_left: T, right: T): T => right;

describe("smoke: addEdge(N[], target) fan-in semantics", () => {
  it("fan-in node's input reflects both parallel branches' updates and runs exactly once", async () => {
    const SmokeState = Annotation.Root({
      a: Annotation<string | null>({ reducer: overwrite, default: () => null }),
      b: Annotation<string | null>({ reducer: overwrite, default: () => null }),
    });

    let fanInCallCount = 0;
    let seenAtFanIn: { a: string | null; b: string | null } | null = null;

    const graph = new StateGraph(SmokeState)
      .addNode("branchA", async () => ({ a: "from-a" }))
      .addNode("branchB", async () => ({ b: "from-b" }))
      .addNode("fanIn", async (state) => {
        fanInCallCount += 1;
        seenAtFanIn = { a: state.a, b: state.b };
        return {};
      })
      .addEdge(START, "branchA")
      .addEdge(START, "branchB")
      .addEdge(["branchA", "branchB"], "fanIn")
      .addEdge("fanIn", END)
      .compile();

    await graph.invoke({});

    // Proves fan-in waits for ALL upstream branches, not just the first to finish.
    expect(seenAtFanIn).toEqual({ a: "from-a", b: "from-b" });
    // Proves fan-in runs exactly once, not once per incoming edge.
    expect(fanInCallCount).toBe(1);
  });
});
