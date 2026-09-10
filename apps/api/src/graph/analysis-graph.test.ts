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
// (Task 4), patternDetectorNode (Task 5), and vulnerabilityDetectorNode (Task 6) are now
// real — all five import db/queries and lib/company-context (which in turn opens real
// ioredis connections at module load). Mocked here so this DAG-level test stays isolated
// from Postgres/Redis: an empty result list drives intentAnalyzer/sentimentClusterer/
// changeDetector down their no-LLM-call short-circuit/defensive paths, an `undefined`
// getFirstSignalCollectedAt drives patternDetector down its own <90-day Phase 2 skip, and
// an empty baseline/diffs list feeds vulnerabilityDetector's pricing context (its window
// call itself is mocked below to always resolve window_open: false).
const {
  getRecentSignalsByCompetitorAndSourceMock,
  getRecentPricingDiffsMock,
  getLatestPricingBaselineMock,
  getSignalVolumeByDayMock,
  getFirstSignalCollectedAtMock,
  getLatestSignalScoresMock,
  createSignalScoreMock,
  completeAgentRunMock,
} = vi.hoisted(() => ({
  getRecentSignalsByCompetitorAndSourceMock: vi.fn().mockResolvedValue([]),
  getRecentPricingDiffsMock: vi.fn().mockResolvedValue([]),
  getLatestPricingBaselineMock: vi.fn().mockResolvedValue(undefined),
  getSignalVolumeByDayMock: vi.fn().mockResolvedValue([]),
  getFirstSignalCollectedAtMock: vi.fn().mockResolvedValue(undefined),
  getLatestSignalScoresMock: vi.fn().mockResolvedValue([]),
  createSignalScoreMock: vi.fn((input: { competitor_id: string; score: number }) =>
    Promise.resolve({
      id: "signal-score-1",
      competitor_id: input.competitor_id,
      score: input.score,
      components: {},
      delta_7d: null,
      delta_30d: null,
      computed_at: new Date(),
    })
  ),
  completeAgentRunMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/queries", () => ({
  getRecentSignalsByCompetitorAndSource: getRecentSignalsByCompetitorAndSourceMock,
  getRecentPricingDiffs: getRecentPricingDiffsMock,
  getLatestPricingBaseline: getLatestPricingBaselineMock,
  getSignalVolumeByDay: getSignalVolumeByDayMock,
  getFirstSignalCollectedAt: getFirstSignalCollectedAtMock,
  getLatestSignalScores: getLatestSignalScoresMock,
  createSignalScore: createSignalScoreMock,
  completeAgentRun: completeAgentRunMock,
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

// synthesisNode (Task 7) selects Claude Sonnet via the adaptive router before its decision
// call — mocked to return the preferred alias unchanged so the DAG test stays offline.
vi.mock("../llm/adaptive-router", () => ({
  selectModel: vi.fn((preferredModel: string) => Promise.resolve(preferredModel)),
}));

const { patternsParsed, vulnerabilityWindowClosedParsed } = vi.hoisted(() => ({
  patternsParsed: { summary: "Stable signal volume.", trend: "stable" as const },
  // Drives vulnerabilityDetectorNode's own short-circuit (see vulnerability-detector.ts)
  // so this DAG test never needs to also mock ChatAnthropic for its second call.
  vulnerabilityWindowClosedParsed: { window_open: false, reasoning: "No open vulnerability window." },
}));

vi.mock("@langchain/openai", () => {
  // patternDetectorNode and vulnerabilityDetectorNode's first call both use ChatOpenAI
  // with different Zod schemas — this single shared mock can't inspect the schema, so it
  // branches on the system prompt text instead (vulnerability-detector.ts's prompt
  // mentions "vulnerability window", pattern-detector.ts's does not).
  const invoke = vi.fn().mockImplementation((messages: [string, string][]) => {
    const [systemMessage] = messages;
    const parsed = systemMessage[1].includes("vulnerability window")
      ? vulnerabilityWindowClosedParsed
      : patternsParsed;
    return Promise.resolve({
      raw: { usage_metadata: { input_tokens: 0, output_tokens: 0 } },
      parsed,
    });
  });
  class ChatOpenAIMockClass {
    withStructuredOutput() {
      return { invoke };
    }
  }
  return { ChatOpenAI: vi.fn(ChatOpenAIMockClass) };
});

// synthesisNode (Task 7) is the only node whose ChatAnthropic call actually fires in this
// DAG test — vulnerabilityDetectorNode short-circuits on window_open: false above. It always
// resolves to a "digest" decision so the fan-in node has a valid AnalysisDecision to return.
const { synthesisDecisionParsed } = vi.hoisted(() => ({
  synthesisDecisionParsed: { action: "digest" as const, reason: "Routine movement." },
}));
vi.mock("@langchain/anthropic", () => {
  const invoke = vi.fn().mockResolvedValue({
    raw: { usage_metadata: { input_tokens: 0, output_tokens: 0 } },
    parsed: synthesisDecisionParsed,
  });
  class ChatAnthropicMockClass {
    withStructuredOutput() {
      return { invoke };
    }
  }
  return { ChatAnthropic: vi.fn(ChatAnthropicMockClass) };
});

import { analysisGraph } from "./analysis-graph";

const LOG_MESSAGES = {
  changeDetector: "change-detector: no recent pricing diffs found — unexpected since the router only invokes this node when has_pricing_diff is true",
} as const;

function callCountFor(message: string): number {
  return loggerWarnMock.mock.calls.filter(([msg]) => msg === message).length;
}

describe("analysisGraph — compiled DAG", () => {
  beforeEach(() => {
    loggerWarnMock.mockClear();
    createSignalScoreMock.mockClear();
    completeAgentRunMock.mockClear();
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
    // vulnerabilityDetectorNode is real now (Task 6) — the shared ChatOpenAI mock above
    // resolves its window-identification call to window_open: false, so it short-circuits
    // before ever reaching the Claude Sonnet positioning-copy call.
    expect(result.vulnerability).toEqual({
      summary: "No open vulnerability window.",
      window_open: false,
      positioning_copy: "",
    });
    // (b) changeDetector runs when has_pricing_diff is true — it takes its own
    // defensive no-diffs-found short-circuit since getRecentPricingDiffs is mocked to
    // return [] (real behavior since Task 4).
    expect(callCountFor(LOG_MESSAGES.changeDetector)).toBe(1);
    // (c) synthesis runs exactly once as the fan-in, not once per source — it persists one
    // Signal Score (all components 0 on empty mocked data → composite 50) and closes the run
    // with the mocked "digest" decision.
    expect(result.signal_score).toMatchObject({ competitor_id: "competitor-1", score: 50 });
    expect(result.decision).toEqual(synthesisDecisionParsed);
    expect(createSignalScoreMock).toHaveBeenCalledTimes(1);
    expect(completeAgentRunMock).toHaveBeenCalledWith("run-1", "completed", "digest");
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
    // vulnerabilityDetectorNode is real now (Task 6) — see the short-circuit note in the
    // test above.
    expect(result.vulnerability).toEqual({
      summary: "No open vulnerability window.",
      window_open: false,
      positioning_copy: "",
    });
    // (b) changeDetector is skipped when has_pricing_diff is false
    expect(callCountFor(LOG_MESSAGES.changeDetector)).toBe(0);
    // (c) synthesis still runs exactly once — fan-in must not deadlock waiting on the
    // skipped changeDetector branch, and must not double-fire via the conditional's direct
    // "synthesis" path plus the fan-in array edge.
    expect(createSignalScoreMock).toHaveBeenCalledTimes(1);
    expect(result.decision).toEqual(synthesisDecisionParsed);
    expect(completeAgentRunMock).toHaveBeenCalledWith("run-2", "completed", "digest");
    //
    // KNOWN PART-9 WIRING DEFECT (out of Task 7's scope — analysis-graph.ts must not change
    // here): on the has_pricing_diff=false path the START->synthesis conditional edge fires
    // synthesis in superstep 1, in parallel with (not after) the 4 branch nodes, so synthesis
    // reads null for every branch output. It still persists a score, but from empty inputs:
    // all 4 numeric components are 0 and vulnerability is null -> "none" (-6 modifier) -> 44,
    // vs. 50 on the true path where the fan-in genuinely waits. This assertion is a sentinel:
    // when the graph is fixed so synthesis is a true fan-in on BOTH paths, this becomes 50
    // (window status "closed") and this comment goes away.
    expect(result.signal_score).toMatchObject({ competitor_id: "competitor-2", score: 44 });
    expect(result.vulnerability).not.toBeNull(); // branch DID run — synthesis just ran before it
  });
});
