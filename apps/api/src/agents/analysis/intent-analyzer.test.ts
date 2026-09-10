import { describe, it, expect, vi, beforeEach } from "vitest";

const { getRecentSignalsByCompetitorAndSourceMock } = vi.hoisted(() => ({
  getRecentSignalsByCompetitorAndSourceMock: vi.fn(),
}));

vi.mock("../../db/queries", () => ({
  getRecentSignalsByCompetitorAndSource: getRecentSignalsByCompetitorAndSourceMock,
}));

const { getCompanyContextMock } = vi.hoisted(() => ({
  getCompanyContextMock: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../lib/company-context", () => ({
  getCompanyContext: getCompanyContextMock,
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/logger", () => ({ logger: loggerMock }));

const { trackCostMock, getDailySpendMock } = vi.hoisted(() => ({
  trackCostMock: vi.fn().mockResolvedValue(0),
  getDailySpendMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("../../llm/cost-tracker", () => ({
  trackCost: trackCostMock,
  getDailySpend: getDailySpendMock,
}));

const { selectModelMock, getDailyBudgetMock } = vi.hoisted(() => ({
  // gpt-4o has a DOWNGRADE_MAP target, but the budget gate runs first — so with spend < budget
  // selectModel returns the preferred model unchanged. Mirror that.
  selectModelMock: vi.fn((preferredModel: string) => Promise.resolve(preferredModel)),
  getDailyBudgetMock: vi.fn(() => 100),
}));

vi.mock("../../llm/adaptive-router", () => ({
  selectModel: selectModelMock,
  getDailyBudget: getDailyBudgetMock,
}));

const { getActivePromptMock } = vi.hoisted(() => ({
  getActivePromptMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../llm/prompt-registry", () => ({
  getActivePrompt: getActivePromptMock,
}));

const { trackLatencyMock } = vi.hoisted(() => ({
  // Mirrors the real trackLatency's pass-through contract (call fn, return its
  // result) so tests exercise the actual invoke() call through the wrapper.
  trackLatencyMock: vi.fn(
    (_agentName: string, _competitorId: string, _runId: string, fn: () => unknown) => fn()
  ),
}));

vi.mock("../../lib/latency-tracker", () => ({
  trackLatency: trackLatencyMock,
}));

const { invokeMock, withStructuredOutputMock, chatOpenAIMock } = vi.hoisted(() => {
  const invokeMock = vi.fn();
  const withStructuredOutputMock = vi.fn(() => ({ invoke: invokeMock }));
  // Real class as the mock implementation (same pattern as entity-extractor.test.ts) —
  // an arrow-function mockImplementation can't be `new`'d, which is exactly what
  // intent-analyzer.ts does with ChatOpenAI.
  class ChatOpenAIMockClass {
    withStructuredOutput = withStructuredOutputMock;
  }
  const chatOpenAIMock = vi.fn(ChatOpenAIMockClass);
  return { invokeMock, withStructuredOutputMock, chatOpenAIMock };
});

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: chatOpenAIMock,
}));

import { intentAnalyzerNode } from "./intent-analyzer";

const state = {
  competitor_id: "c1",
  run_id: "run1",
  has_pricing_diff: false,
  hiring_intent: null,
  sentiment_clusters: null,
  pricing_change: null,
  patterns: null,
  vulnerability: null,
  signal_score: null,
  decision: null,
} as never;

const jobSignal = {
  id: "s1",
  competitor_id: "c1",
  source: "jobs" as const,
  source_url: null,
  title: "Senior Backend Engineer",
  raw_text: "We're hiring a senior backend engineer to build out our platform.",
  quality_score: 0,
  entities: {},
  cluster_id: null,
  collected_at: new Date(),
  created_at: new Date(),
};

const parsedResult = { summary: "Ramping up engineering hiring.", intent_level: "medium" };

function invokeResult(overrides: Partial<{ raw: Record<string, unknown>; parsed: unknown }> = {}) {
  return {
    raw: { usage_metadata: { input_tokens: 50, output_tokens: 10 } },
    parsed: parsedResult,
    ...overrides,
  };
}

describe("agents/analysis/intent-analyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentSignalsByCompetitorAndSourceMock.mockResolvedValue([jobSignal]);
    getCompanyContextMock.mockResolvedValue("");
    trackCostMock.mockResolvedValue(0);
    getDailySpendMock.mockResolvedValue(0);
    getDailyBudgetMock.mockReturnValue(100);
    selectModelMock.mockImplementation((preferredModel: string) => Promise.resolve(preferredModel));
    getActivePromptMock.mockResolvedValue(null);
    invokeMock.mockResolvedValue(invokeResult());
    trackLatencyMock.mockImplementation(
      (_a: string, _c: string, _r: string, fn: () => unknown) => fn()
    );
  });

  it("short-circuits with a low-intent default and makes no LLM call when there are no recent job postings", async () => {
    getRecentSignalsByCompetitorAndSourceMock.mockResolvedValue([]);

    const result = await intentAnalyzerNode(state);

    expect(result).toEqual({
      hiring_intent: { summary: "No recent job postings found.", intent_level: "low" },
    });
    expect(chatOpenAIMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(trackCostMock).not.toHaveBeenCalled();
  });

  it("queries recent jobs-source signals for the competitor over the last 7 days", async () => {
    await intentAnalyzerNode(state);

    expect(getRecentSignalsByCompetitorAndSourceMock).toHaveBeenCalledWith("c1", "jobs", 7);
  });

  it("passes selectModel's chosen model to ChatOpenAI", async () => {
    selectModelMock.mockResolvedValue("gpt-4o-downgraded");

    await intentAnalyzerNode(state);

    expect(selectModelMock).toHaveBeenCalledWith("gpt-4o", true);
    expect(chatOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-downgraded" })
    );
  });

  it("skips the LLM call and returns {} when the daily budget is exhausted", async () => {
    getDailySpendMock.mockResolvedValue(500);

    const result = await intentAnalyzerNode(state);

    expect(result).toEqual({});
    expect(chatOpenAIMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(trackCostMock).not.toHaveBeenCalled();
  });

  it("degrades to {} (no rethrow) and logs error context when the body throws", async () => {
    getRecentSignalsByCompetitorAndSourceMock.mockRejectedValue(new Error("db down"));

    const result = await intentAnalyzerNode(state);

    expect(result).toEqual({});
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("degrading"),
      expect.objectContaining({ agent_name: "intent_analyzer", competitor_id: "c1", run_id: "run1" })
    );
  });

  it("uses the active prompt from the registry when one exists, else SYSTEM_PROMPT_BASE", async () => {
    getActivePromptMock.mockResolvedValue("CUSTOM REGISTRY PROMPT");
    await intentAnalyzerNode(state);
    let [messages] = invokeMock.mock.calls[0];
    let [systemMessage] = messages as [string, string][];
    expect(systemMessage[1]).toContain("CUSTOM REGISTRY PROMPT");

    invokeMock.mockClear();
    getActivePromptMock.mockResolvedValue(null);
    await intentAnalyzerNode(state);
    [messages] = invokeMock.mock.calls[0];
    [systemMessage] = messages as [string, string][];
    expect(systemMessage[1]).toContain("infer their hiring");
  });

  it("calls gpt-4o via ChatOpenAI with structured output over the concatenated postings", async () => {
    const result = await intentAnalyzerNode(state);

    expect(chatOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o" })
    );
    expect(withStructuredOutputMock).toHaveBeenCalledWith(
      expect.anything(),
      { includeRaw: true }
    );
    expect(invokeMock).toHaveBeenCalledWith([
      ["system", expect.any(String)],
      ["human", expect.stringContaining(jobSignal.raw_text)],
    ]);
    expect(result).toEqual({ hiring_intent: parsedResult });
  });

  it("injects company context into the system prompt when a profile exists", async () => {
    getCompanyContextMock.mockResolvedValue("ABOUT THE USER'S COMPANY:\nProduct: Signal");

    await intentAnalyzerNode(state);

    const [messages] = invokeMock.mock.calls[0];
    const [systemMessage] = messages as [string, string][];
    expect(systemMessage[1]).toContain("ABOUT THE USER'S COMPANY:");
  });

  it("wraps the LLM invocation in trackLatency with intent_analyzer/competitor_id/run_id", async () => {
    await intentAnalyzerNode(state);

    expect(trackLatencyMock).toHaveBeenCalledWith(
      "intent_analyzer",
      "c1",
      "run1",
      expect.any(Function)
    );
  });

  it("tracks cost using the real token counts from usage_metadata", async () => {
    invokeMock.mockResolvedValue(
      invokeResult({ raw: { usage_metadata: { input_tokens: 200, output_tokens: 40 } } })
    );

    await intentAnalyzerNode(state);

    expect(trackCostMock).toHaveBeenCalledWith(
      "intent_analyzer",
      "gpt-4o",
      200,
      40,
      "run1",
      "c1"
    );
  });

  it("degrades to {} when structured output fails schema validation (parsed is null), not rethrown", async () => {
    invokeMock.mockResolvedValue(invokeResult({ parsed: null }));

    const result = await intentAnalyzerNode(state);

    expect(result).toEqual({});
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("schema validation"),
      expect.objectContaining({ competitor_id: "c1", run_id: "run1" })
    );
  });
});
