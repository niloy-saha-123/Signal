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
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// intentAnalyzerNode (Task 2) and sentimentClustererNode (Task 3) are now real — both
// import db/queries and lib/company-context (which in turn opens real ioredis connections
// at module load). Mocked here so this DAG-level test stays isolated from Postgres/Redis: an
// empty signals list drives both nodes down their no-LLM-call short-circuit paths.
const { getRecentSignalsByCompetitorAndSourceMock } = vi.hoisted(() => ({
  getRecentSignalsByCompetitorAndSourceMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/queries", () => ({
  getRecentSignalsByCompetitorAndSource: getRecentSignalsByCompetitorAndSourceMock,
}));

vi.mock("../lib/company-context", () => ({
  getCompanyContext: vi.fn().mockResolvedValue(""),
}));

import { analysisGraph } from "./analysis-graph";

const LOG_MESSAGES = {
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
    const result = await analysisGraph.invoke({
      competitor_id: "competitor-1",
      run_id: "run-1",
      has_pricing_diff: true,
    });

    // (a) all expected nodes ran — intentAnalyzerNode and sentimentClustererNode are real now
    // (Tasks 2-3) and take their no-recent-signals short-circuits since
    // getRecentSignalsByCompetitorAndSource is mocked to return [].
    expect(result.hiring_intent).toEqual({
      summary: "No recent job postings found.",
      intent_level: "low",
    });
    expect(result.sentiment_clusters).toEqual({
      summary: "No recent community discussion found.",
      new_complaints: [],
      chronic_complaints: [],
    });
    expect(callCountFor(LOG_MESSAGES.patternDetector)).toBe(1);
    expect(callCountFor(LOG_MESSAGES.vulnerabilityDetector)).toBe(1);
    // (b) changeDetector runs when has_pricing_diff is true
    expect(callCountFor(LOG_MESSAGES.changeDetector)).toBe(1);
    // (c) synthesis runs exactly once, not once per fan-in source
    expect(callCountFor(LOG_MESSAGES.synthesis)).toBe(1);
  });

  it("skips changeDetector and still runs synthesis exactly once when has_pricing_diff is false", async () => {
    const result = await analysisGraph.invoke({
      competitor_id: "competitor-2",
      run_id: "run-2",
      has_pricing_diff: false,
    });

    // (a) all expected nodes ran — see the short-circuit note in the test above.
    expect(result.hiring_intent).toEqual({
      summary: "No recent job postings found.",
      intent_level: "low",
    });
    expect(result.sentiment_clusters).toEqual({
      summary: "No recent community discussion found.",
      new_complaints: [],
      chronic_complaints: [],
    });
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
