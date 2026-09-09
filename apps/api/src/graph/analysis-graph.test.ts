// Full-graph invocation tests for the compiled 6-node analysis DAG. Complements
// analysis-graph.smoke.test.ts (which proves the underlying LangGraph.js mechanisms in
// isolation) — this file proves the real graph, wired with the real Task-3 node stubs, behaves
// correctly end to end.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { loggerWarnMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import { analysisGraph } from "./analysis-graph";

const LOG_MESSAGES = {
  intentAnalyzer: "intentAnalyzerNode: not yet implemented (Part 10) — returning no-op update",
  sentimentClusterer: "sentimentClustererNode: not yet implemented (Part 10) — returning no-op update",
  changeDetector: "changeDetectorNode: not yet implemented (Part 10) — returning no-op update",
  patternDetector: "patternDetectorNode: not yet implemented (Part 10) — returning no-op update",
  vulnerabilityDetector: "vulnerabilityDetectorNode: not yet implemented (Part 10) — returning no-op update",
  synthesis: "synthesisNode: not yet implemented (Part 10) — returning no-op update",
} as const;

function callCountFor(message: string): number {
  return loggerWarnMock.mock.calls.filter(([msg]) => msg === message).length;
}

describe("analysisGraph — compiled DAG", () => {
  beforeEach(() => {
    loggerWarnMock.mockClear();
  });

  it("runs changeDetector and all other nodes, synthesis exactly once, when has_pricing_diff is true", async () => {
    await analysisGraph.invoke({
      competitor_id: "competitor-1",
      run_id: "run-1",
      has_pricing_diff: true,
    });

    // (a) all expected nodes ran
    expect(callCountFor(LOG_MESSAGES.intentAnalyzer)).toBe(1);
    expect(callCountFor(LOG_MESSAGES.sentimentClusterer)).toBe(1);
    expect(callCountFor(LOG_MESSAGES.patternDetector)).toBe(1);
    expect(callCountFor(LOG_MESSAGES.vulnerabilityDetector)).toBe(1);
    // (b) changeDetector runs when has_pricing_diff is true
    expect(callCountFor(LOG_MESSAGES.changeDetector)).toBe(1);
    // (c) synthesis runs exactly once, not once per fan-in source
    expect(callCountFor(LOG_MESSAGES.synthesis)).toBe(1);
  });

  it("skips changeDetector and still runs synthesis exactly once when has_pricing_diff is false", async () => {
    await analysisGraph.invoke({
      competitor_id: "competitor-2",
      run_id: "run-2",
      has_pricing_diff: false,
    });

    // (a) all expected nodes ran
    expect(callCountFor(LOG_MESSAGES.intentAnalyzer)).toBe(1);
    expect(callCountFor(LOG_MESSAGES.sentimentClusterer)).toBe(1);
    expect(callCountFor(LOG_MESSAGES.patternDetector)).toBe(1);
    expect(callCountFor(LOG_MESSAGES.vulnerabilityDetector)).toBe(1);
    // (b) changeDetector is skipped when has_pricing_diff is false
    expect(callCountFor(LOG_MESSAGES.changeDetector)).toBe(0);
    // (c) synthesis still runs exactly once — fan-in must not deadlock waiting on the
    // skipped changeDetector branch, and must not double-fire via the conditional's direct
    // "synthesis" path plus the fan-in array edge.
    expect(callCountFor(LOG_MESSAGES.synthesis)).toBe(1);
  });
});
