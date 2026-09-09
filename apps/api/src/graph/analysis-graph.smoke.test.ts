// Standalone smoke tests proving two uncertain LangGraph.js API mechanisms BEFORE they're
// relied on in the real 6-node analysis-graph.ts. Both use throwaway state schemas — no
// dependency on AnalysisGraphState or the real node stubs. Per task-4-brief.md, this is the
// part's highest-uncertainty task; these are the RED/GREEN evidence for that uncertainty.
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

describe("smoke: START with both unconditional addEdge calls and addConditionalEdges", () => {
  it("compiles and routes correctly when START has 2 unconditional edges plus 1 conditional edge", async () => {
    const concatReducer = (left: string[], right: string[]): string[] => [...left, ...right];
    const SmokeState2 = Annotation.Root({
      flag: Annotation<boolean>({ reducer: overwrite, default: () => false }),
      ran: Annotation<string[]>({ reducer: concatReducer, default: () => [] }),
    });

    const graph = new StateGraph(SmokeState2)
      .addNode("always1", async () => ({ ran: ["always1"] }))
      .addNode("always2", async () => ({ ran: ["always2"] }))
      .addNode("condTarget", async () => ({ ran: ["condTarget"] }))
      .addNode("skip", async () => ({ ran: ["skip"] }))
      .addEdge(START, "always1")
      .addEdge(START, "always2")
      .addConditionalEdges(START, (state) => (state.flag ? "condTarget" : "skip"), {
        condTarget: "condTarget",
        skip: "skip",
      })
      .addEdge("always1", END)
      .addEdge("always2", END)
      .addEdge("condTarget", END)
      .addEdge("skip", END)
      .compile();

    const whenTrue = await graph.invoke({ flag: true });
    expect([...whenTrue.ran].sort()).toEqual(["always1", "always2", "condTarget"]);

    const whenFalse = await graph.invoke({ flag: false });
    expect([...whenFalse.ran].sort()).toEqual(["always1", "always2", "skip"]);
  });
});
