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

// intentAnalyzerNode (Task 2), sentimentClustererNode (Task 3), changeDetectorNode
// (Task 4), and patternDetectorNode (Task 5) are now real — all four import db/queries and
// lib/company-context (which in turn opens real ioredis connections at module load).
// Mocked here so this DAG-level test stays isolated from Postgres/Redis: an empty result
// list drives intentAnalyzer/sentimentClusterer/changeDetector down their no-LLM-call
// short-circuit/defensive paths, and an `undefined` getFirstSignalCollectedAt drives
// patternDetector down its own <90-day Phase 2 skip.
const {
  getRecentSignalsByCompetitorAndSourceMock,
  getRecentPricingDiffsMock,
  getSignalVolumeByDayMock,
  getFirstSignalCollectedAtMock,
} = vi.hoisted(() => ({
  getRecentSignalsByCompetitorAndSourceMock: vi.fn().mockResolvedValue([]),
  getRecentPricingDiffsMock: vi.fn().mockResolvedValue([]),
  getSignalVolumeByDayMock: vi.fn().mockResolvedValue([]),
  getFirstSignalCollectedAtMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/queries", () => ({
  getRecentSignalsByCompetitorAndSource: getRecentSignalsByCompetitorAndSourceMock,
  getRecentPricingDiffs: getRecentPricingDiffsMock,
  getSignalVolumeByDay: getSignalVolumeByDayMock,
  getFirstSignalCollectedAt: getFirstSignalCollectedAtMock,
}));

vi.mock("../lib/company-context", () => ({
  getCompanyContext: vi.fn().mockResolvedValue(""),
}));

// patternDetectorNode (Task 5) is unconditional about calling hybridRetrieve's module and
// the LLM — mocked here for the same Postgres/Redis/Pinecone/network isolation reasons as
// db/queries and company-context above. getFirstSignalCollectedAtMock resolving undefined
// means hybridRetrieve is never actually invoked by this DAG test, but the module (and its
// own Pinecone/embeddings imports) would still load without this mock.
vi.mock("../retrieval", () => ({
  hybridRetrieve: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/latency-tracker", () => ({
  trackLatency: vi.fn((_agentName: string, _competitorId: string, _runId: string, fn: () => unknown) =>
    fn()
  ),
}));

vi.mock("../llm/cost-tracker", () => ({
  trackCost: vi.fn().mockResolvedValue(0),
}));

const { patternsParsed } = vi.hoisted(() => ({
  patternsParsed: { summary: "Stable signal volume.", trend: "stable" as const },
}));

vi.mock("@langchain/openai", () => {
  const invoke = vi
    .fn()
    .mockResolvedValue({ raw: { usage_metadata: { input_tokens: 0, output_tokens: 0 } }, parsed: patternsParsed });
  class ChatOpenAIMockClass {
    withStructuredOutput() {
      return { invoke };
    }
  }
  return { ChatOpenAI: vi.fn(ChatOpenAIMockClass) };
});

import { analysisGraph } from "./analysis-graph";

const LOG_MESSAGES = {
  changeDetector: "change-detector: no recent pricing diffs found — unexpected since the router only invokes this node when has_pricing_diff is true",
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
    // patternDetectorNode is real now (Task 5) — it takes its own <90-day Phase 2 skip
    // since getFirstSignalCollectedAt is mocked to resolve undefined, and produces the
    // mocked ChatOpenAI structured output from Phase 1 data alone.
    expect(result.patterns).toEqual(patternsParsed);
    expect(callCountFor(LOG_MESSAGES.vulnerabilityDetector)).toBe(1);
    // (b) changeDetector runs when has_pricing_diff is true — it takes its own
    // defensive no-diffs-found short-circuit since getRecentPricingDiffs is mocked to
    // return [] (real behavior since Task 4).
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
    // patternDetectorNode is real now (Task 5) — it takes its own <90-day Phase 2 skip
    // since getFirstSignalCollectedAt is mocked to resolve undefined, and produces the
    // mocked ChatOpenAI structured output from Phase 1 data alone.
    expect(result.patterns).toEqual(patternsParsed);
    expect(callCountFor(LOG_MESSAGES.vulnerabilityDetector)).toBe(1);
    // (b) changeDetector is skipped when has_pricing_diff is false
    expect(callCountFor(LOG_MESSAGES.changeDetector)).toBe(0);
    // (c) synthesis still runs exactly once — fan-in must not deadlock waiting on the
    // skipped changeDetector branch, and must not double-fire via the conditional's direct
    // "synthesis" path plus the fan-in array edge.
    expect(callCountFor(LOG_MESSAGES.synthesis)).toBe(1);
  });
});
