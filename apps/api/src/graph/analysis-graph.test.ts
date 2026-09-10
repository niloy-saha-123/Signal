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
  // branch-node.ts's isLlmBudgetExhausted reads this — 0 spend keeps every branch on its
  // normal path in this DAG test.
  getDailySpend: vi.fn().mockResolvedValue(0),
}));

// synthesisNode (Task 7) selects Claude Sonnet via the adaptive router before its decision
// call — mocked to return the preferred alias unchanged so the DAG test stays offline.
// getDailyBudget feeds branch-node.ts's isLlmBudgetExhausted alongside getDailySpend above.
vi.mock("../llm/adaptive-router", () => ({
  selectModel: vi.fn((preferredModel: string) => Promise.resolve(preferredModel)),
  getDailyBudget: vi.fn(() => 100),
  ANTHROPIC_MODEL_IDS: {
    "claude-haiku": "claude-haiku-4-5-20251001",
    "claude-sonnet": "claude-sonnet-5",
  },
}));

// All 6 nodes now consult the prompt registry (prod-review M1) — mocked to return null so
// each falls back to its hardcoded SYSTEM_PROMPT_BASE, keeping this DAG test off Postgres.
vi.mock("../llm/prompt-registry", () => ({
  getActivePrompt: vi.fn().mockResolvedValue(null),
}));

const { intentParsed, patternsParsed, vulnerabilityWindowClosedParsed } = vi.hoisted(() => ({
  intentParsed: { summary: "Hiring aggressively for enterprise sales.", intent_level: "high" as const },
  patternsParsed: { summary: "Signal volume rising.", trend: "increasing" as const },
  vulnerabilityWindowClosedParsed: { window_open: false, reasoning: "No open vulnerability window." },
}));

// The three GPT-4o(-mini) nodes (intentAnalyzer, patternDetector, vulnerabilityDetector's
// first call) all use ChatOpenAI with different Zod schemas — this one shared mock can't see
// the schema, so it branches on the system-prompt text: intent-analyzer's says "job postings"
// and "hiring", vulnerability-detector's says "vulnerability window", pattern-detector's
// neither. Most DAG tests here feed every branch empty data so they short-circuit before the
// LLM; the "exercises a real branch LLM path" test overrides specific query mocks so
// intentAnalyzer + patternDetector actually invoke through the compiled graph.
vi.mock("@langchain/openai", () => {
  const invoke = vi.fn().mockImplementation((messages: [string, string][]) => {
    const promptText = messages[0][1];
    let parsed: unknown = patternsParsed;
    if (promptText.includes("hiring")) parsed = intentParsed;
    else if (promptText.includes("vulnerability window")) parsed = vulnerabilityWindowClosedParsed;
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
  changeDetector: "change-detector: has_pricing_diff was set but no recent pricing diffs found — diff may have aged out of the 7-day window",
} as const;

function callCountFor(message: string): number {
  return loggerWarnMock.mock.calls.filter(([msg]) => msg === message).length;
}

describe("analysisGraph — compiled DAG", () => {
  beforeEach(() => {
    loggerWarnMock.mockClear();
    createSignalScoreMock.mockClear();
    completeAgentRunMock.mockClear();
    // Reset the two query mocks that individual tests override with non-empty data.
    getRecentSignalsByCompetitorAndSourceMock.mockReset().mockResolvedValue([]);
    getSignalVolumeByDayMock.mockReset().mockResolvedValue([]);
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
    // since getFirstSignalCollectedAt is mocked to resolve undefined, and then hits its
    // ts-review-M3 empty-input short-circuit (getSignalVolumeByDay mocked to [], no
    // retrieved chunks) — a real "nothing to analyze" result, no LLM call.
    expect(result.patterns).toEqual({
      summary: "No recent signal activity to analyze.",
      trend: "stable",
    });
    // vulnerabilityDetectorNode is real now (Task 6) — with every signal source, the
    // pricing baseline and diffs all mocked empty it hits its ts-review-M3 empty-input
    // short-circuit (a real "nothing to assess" result, neither LLM call fires).
    expect(result.vulnerability).toEqual({
      summary: "No recent competitor activity to assess.",
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

  it("no-ops changeDetector and runs synthesis exactly once, after all branches, when has_pricing_diff is false", async () => {
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
    // since getFirstSignalCollectedAt is mocked to resolve undefined, and then hits its
    // ts-review-M3 empty-input short-circuit (getSignalVolumeByDay mocked to [], no
    // retrieved chunks) — a real "nothing to analyze" result, no LLM call.
    expect(result.patterns).toEqual({
      summary: "No recent signal activity to analyze.",
      trend: "stable",
    });
    // vulnerabilityDetectorNode is real now (Task 6) — see the short-circuit note in the
    // test above.
    expect(result.vulnerability).toEqual({
      summary: "No recent competitor activity to assess.",
      window_open: false,
      positioning_copy: "",
    });
    // (b) changeDetector runs (unconditionally, since Part 10's wiring fix) but no-ops
    // immediately on has_pricing_diff=false — no DB call, no LLM call, no warning log.
    expect(callCountFor(LOG_MESSAGES.changeDetector)).toBe(0);
    // (c) synthesis runs exactly once, genuinely AFTER all 5 branches — the 5-way fan-in is
    // the only trigger now (no direct START->synthesis conditional edge to race it ahead).
    // So synthesis reads the real branch outputs: vulnerability window "closed" (not null),
    // all 4 numeric components 0 on the empty mocked data → composite 50.
    expect(createSignalScoreMock).toHaveBeenCalledTimes(1);
    expect(result.decision).toEqual(synthesisDecisionParsed);
    expect(completeAgentRunMock).toHaveBeenCalledWith("run-2", "completed", "digest");
    expect(result.signal_score).toMatchObject({ competitor_id: "competitor-2", score: 50 });
    expect(result.vulnerability).not.toBeNull();
  });

  it("exercises a real branch LLM path end-to-end: intentAnalyzer + patternDetector invoke through the compiled graph", async () => {
    // Feed jobs signals + volume data so these two branches skip their empty-input
    // short-circuits and actually run their GPT-4o calls; the rest stay empty/short-circuited.
    getRecentSignalsByCompetitorAndSourceMock.mockImplementation((_id: string, source: string) =>
      Promise.resolve(
        source === "jobs"
          ? [{ id: "s1", competitor_id: "competitor-3", source: "jobs", title: "Enterprise AE", raw_text: "Hiring 10 enterprise account executives." }]
          : []
      )
    );
    getSignalVolumeByDayMock.mockResolvedValue([
      { day: new Date(Date.now() - 3 * 86400000).toISOString(), count: 12, weighted_count: 12 },
      { day: new Date(Date.now() - 1 * 86400000).toISOString(), count: 20, weighted_count: 20 },
    ]);

    const result = await analysisGraph.invoke({
      competitor_id: "competitor-3",
      run_id: "run-3",
      has_pricing_diff: false,
    });

    // intentAnalyzer's real LLM path ran — result is the mocked structured output, not the
    // "no postings" short-circuit.
    expect(result.hiring_intent).toEqual(intentParsed);
    // patternDetector's Phase-1 trend-synthesis LLM path ran (volume data present, Phase 2
    // still skipped since getFirstSignalCollectedAt is undefined).
    expect(result.patterns).toEqual(patternsParsed);
    // synthesis read the real branch outputs post-fan-in: intent_level "high" → hiring_momentum
    // 1, so the composite score clears the empty-data 50 baseline.
    expect(result.signal_score!.score).toBeGreaterThan(50);
    expect(completeAgentRunMock).toHaveBeenCalledWith("run-3", "completed", "digest");
  });
});
