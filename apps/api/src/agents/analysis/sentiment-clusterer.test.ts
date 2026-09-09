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

const { trackCostMock } = vi.hoisted(() => ({
  trackCostMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("../../llm/cost-tracker", () => ({
  trackCost: trackCostMock,
}));

const { selectModelMock } = vi.hoisted(() => ({
  // "claude-haiku" has no downgrade target in adaptive-router's real DOWNGRADE_MAP, so
  // selectModel always returns the preferred model unchanged — mirror that here.
  selectModelMock: vi.fn((preferredModel: string) => Promise.resolve(preferredModel)),
}));

vi.mock("../../llm/adaptive-router", () => ({
  selectModel: selectModelMock,
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

const { invokeMock, withStructuredOutputMock, chatAnthropicMock } = vi.hoisted(() => {
  const invokeMock = vi.fn();
  const withStructuredOutputMock = vi.fn(() => ({ invoke: invokeMock }));
  // Real class as the mock implementation (same pattern as intent-analyzer.test.ts) — an
  // arrow-function mockImplementation can't be `new`'d, which is exactly what
  // sentiment-clusterer.ts does with ChatAnthropic.
  class ChatAnthropicMockClass {
    withStructuredOutput = withStructuredOutputMock;
  }
  const chatAnthropicMock = vi.fn(ChatAnthropicMockClass);
  return { invokeMock, withStructuredOutputMock, chatAnthropicMock };
});

vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: chatAnthropicMock,
}));

import { sentimentClustererNode } from "./sentiment-clusterer";

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

const redditSignal = {
  id: "s1",
  competitor_id: "c1",
  source: "reddit" as const,
  source_url: null,
  title: "Anyone else frustrated with their support response times?",
  raw_text: "Been waiting 3 days for a reply on a critical bug.",
  quality_score: 0,
  entities: {},
  cluster_id: null,
  collected_at: new Date(),
  created_at: new Date(),
};

const hnSignal = {
  ...redditSignal,
  id: "s2",
  source: "hn" as const,
  title: "Discussion thread about the product",
  raw_text: "The onboarding flow is confusing but the core product is solid.",
};

const parsedResult = {
  summary: "Mixed sentiment, support responsiveness is a recurring concern.",
  new_complaints: ["Confusing onboarding flow"],
  chronic_complaints: ["Slow support response times"],
};

function invokeResult(overrides: Partial<{ raw: Record<string, unknown>; parsed: unknown }> = {}) {
  return {
    raw: { usage_metadata: { input_tokens: 50, output_tokens: 10 } },
    parsed: parsedResult,
    ...overrides,
  };
}

describe("agents/analysis/sentiment-clusterer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentSignalsByCompetitorAndSourceMock.mockImplementation((_id: string, source: string) =>
      Promise.resolve(source === "reddit" ? [redditSignal] : [hnSignal])
    );
    getCompanyContextMock.mockResolvedValue("");
    trackCostMock.mockResolvedValue(0);
    selectModelMock.mockImplementation((preferredModel: string) => Promise.resolve(preferredModel));
    invokeMock.mockResolvedValue(invokeResult());
    trackLatencyMock.mockImplementation(
      (_a: string, _c: string, _r: string, fn: () => unknown) => fn()
    );
  });

  it("short-circuits with an empty-clusters default and makes no LLM call when both sources are empty", async () => {
    getRecentSignalsByCompetitorAndSourceMock.mockResolvedValue([]);

    const result = await sentimentClustererNode(state);

    expect(result).toEqual({
      sentiment_clusters: {
        summary: "No recent community discussion found.",
        new_complaints: [],
        chronic_complaints: [],
      },
    });
    expect(chatAnthropicMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(trackCostMock).not.toHaveBeenCalled();
  });

  it("queries recent reddit and hn signals for the competitor over the last 7 days", async () => {
    await sentimentClustererNode(state);

    expect(getRecentSignalsByCompetitorAndSourceMock).toHaveBeenCalledWith("c1", "reddit", 7);
    expect(getRecentSignalsByCompetitorAndSourceMock).toHaveBeenCalledWith("c1", "hn", 7);
  });

  it("calls Claude Haiku via ChatAnthropic with structured output over the concatenated signals, translating the alias to the real dated model id", async () => {
    const result = await sentimentClustererNode(state);

    // The real Anthropic API model id must reach the ChatAnthropic constructor — the
    // "claude-haiku" alias would make every real call fail with an invalid-model error.
    expect(chatAnthropicMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5-20251001" })
    );
    expect(withStructuredOutputMock).toHaveBeenCalledWith(
      expect.anything(),
      { includeRaw: true }
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [messages] = invokeMock.mock.calls[0];
    const [, humanMessage] = messages as [string, string][];
    expect(humanMessage[1]).toContain(redditSignal.raw_text);
    expect(humanMessage[1]).toContain(hnSignal.raw_text);
    expect(result).toEqual({ sentiment_clusters: parsedResult });
  });

  it("injects company context into the system prompt when a profile exists", async () => {
    getCompanyContextMock.mockResolvedValue("ABOUT THE USER'S COMPANY:\nProduct: Signal");

    await sentimentClustererNode(state);

    const [messages] = invokeMock.mock.calls[0];
    const [systemMessage] = messages as [string, string][];
    expect(systemMessage[1]).toContain("ABOUT THE USER'S COMPANY:");
  });

  it("wraps the LLM invocation in trackLatency with sentiment_clusterer/competitor_id/run_id", async () => {
    await sentimentClustererNode(state);

    expect(trackLatencyMock).toHaveBeenCalledWith(
      "sentiment_clusterer",
      "c1",
      "run1",
      expect.any(Function)
    );
  });

  it("tracks cost using the real token counts and the 'claude-haiku' alias (not the real model id)", async () => {
    invokeMock.mockResolvedValue(
      invokeResult({ raw: { usage_metadata: { input_tokens: 200, output_tokens: 40 } } })
    );

    await sentimentClustererNode(state);

    expect(trackCostMock).toHaveBeenCalledWith(
      "sentiment_clusterer",
      "claude-haiku",
      200,
      40,
      "run1",
      "c1"
    );
  });

  it("throws when structured output fails schema validation (parsed is null)", async () => {
    invokeMock.mockResolvedValue(invokeResult({ parsed: null }));

    await expect(sentimentClustererNode(state)).rejects.toThrow(/schema validation/);

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("schema validation"),
      expect.objectContaining({ competitor_id: "c1", run_id: "run1" })
    );
  });
});
