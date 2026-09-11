import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSignalVolumeByDayMock, getFirstSignalCollectedAtMock, callOrder } = vi.hoisted(() => ({
  getSignalVolumeByDayMock: vi.fn(),
  getFirstSignalCollectedAtMock: vi.fn(),
  callOrder: [] as string[],
}));

vi.mock("@/db/queries", () => ({
  getSignalVolumeByDay: getSignalVolumeByDayMock,
  getFirstSignalCollectedAt: getFirstSignalCollectedAtMock,
}));

const { hybridRetrieveMock } = vi.hoisted(() => ({
  hybridRetrieveMock: vi.fn(),
}));

vi.mock("@/retrieval", () => ({
  hybridRetrieve: hybridRetrieveMock,
}));

const { getCompanyContextMock } = vi.hoisted(() => ({
  getCompanyContextMock: vi.fn().mockResolvedValue(""),
}));

vi.mock("@/lib/company-context", () => ({
  getCompanyContext: getCompanyContextMock,
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

const { trackCostMock, getDailySpendMock } = vi.hoisted(() => ({
  trackCostMock: vi.fn().mockResolvedValue(0),
  getDailySpendMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/llm/cost-tracker", () => ({
  trackCost: trackCostMock,
  getDailySpend: getDailySpendMock,
}));

const { selectModelMock, getDailyBudgetMock } = vi.hoisted(() => ({
  selectModelMock: vi.fn((preferredModel: string) => Promise.resolve(preferredModel)),
  getDailyBudgetMock: vi.fn(() => 100),
}));

vi.mock("@/llm/adaptive-router", () => ({
  selectModel: selectModelMock,
  getDailyBudget: getDailyBudgetMock,
}));

const { getActivePromptMock } = vi.hoisted(() => ({
  getActivePromptMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/llm/prompt-registry", () => ({
  getActivePrompt: getActivePromptMock,
}));

const { trackLatencyMock } = vi.hoisted(() => ({
  // Unlike the pass-through mocks in intent-analyzer.test.ts/change-detector.test.ts, the
  // beforeEach below gives this one an implementation that records start/end markers
  // around fn() so tests can assert the DB/retrieval/LLM mocks fired *inside* the wrapped
  // span, not just that trackLatency was called at all.
  trackLatencyMock: vi.fn(),
}));

vi.mock("@/lib/latency-tracker", () => ({
  trackLatency: trackLatencyMock,
}));

const { invokeMock, withStructuredOutputMock, chatOpenAIMock } = vi.hoisted(() => {
  const invokeMock = vi.fn();
  const withStructuredOutputMock = vi.fn(() => ({ invoke: invokeMock }));
  // Real class as the mock implementation (same pattern as change-detector.test.ts) — an
  // arrow-function mockImplementation can't be `new`'d, which is exactly what
  // pattern-detector.ts does with ChatOpenAI.
  class ChatOpenAIMockClass {
    withStructuredOutput = withStructuredOutputMock;
  }
  const chatOpenAIMock = vi.fn(ChatOpenAIMockClass);
  return { invokeMock, withStructuredOutputMock, chatOpenAIMock };
});

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: chatOpenAIMock,
}));

import { patternDetectorNode } from "@/agents/analysis/pattern-detector";

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

function makeVolumeByDay(counts: number[]) {
  return counts.map((count, i) => ({
    day: `2026-08-${String(10 + i).padStart(2, "0")}T00:00:00`,
    count,
    weighted_count: count * 0.8,
  }));
}

function makeChunk(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "s1",
    competitor_id: "c1",
    source: "reddit",
    source_url: null,
    text: "Competitor raised Pro tier pricing by 20% last month.",
    quality_score: 0.9,
    origin: "both",
    rrf_score: 0.5,
    ...overrides,
  };
}

const parsedResult = {
  summary: "Signal volume is climbing steadily.",
  trend: "increasing" as const,
};

function invokeResult(overrides: Partial<{ raw: Record<string, unknown>; parsed: unknown }> = {}) {
  return {
    raw: { usage_metadata: { input_tokens: 80, output_tokens: 20 } },
    parsed: parsedResult,
    ...overrides,
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe("agents/analysis/pattern-detector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;

    getSignalVolumeByDayMock.mockImplementation(async () => {
      callOrder.push("getSignalVolumeByDay");
      return makeVolumeByDay([1, 2, 3, 5, 8]);
    });
    getFirstSignalCollectedAtMock.mockImplementation(async () => {
      callOrder.push("getFirstSignalCollectedAt");
      return daysAgo(10);
    });
    hybridRetrieveMock.mockImplementation(async () => {
      callOrder.push("hybridRetrieve");
      return [];
    });
    getCompanyContextMock.mockResolvedValue("");
    trackCostMock.mockResolvedValue(0);
    getDailySpendMock.mockResolvedValue(0);
    getDailyBudgetMock.mockReturnValue(100);
    getActivePromptMock.mockResolvedValue(null);
    selectModelMock.mockImplementation((preferredModel: string) => Promise.resolve(preferredModel));
    invokeMock.mockImplementation(async () => {
      callOrder.push("invoke");
      return invokeResult();
    });
    trackLatencyMock.mockImplementation(
      async (_a: string, _c: string, _r: string, fn: () => unknown) => {
        callOrder.push("trackLatency:start");
        const result = await fn();
        callOrder.push("trackLatency:end");
        return result;
      }
    );
  });

  it("always runs Phase 1 (getSignalVolumeByDay) with a 30-day window", async () => {
    await patternDetectorNode(state);

    expect(getSignalVolumeByDayMock).toHaveBeenCalledWith("c1", 30);
  });

  describe("< 90 days of history", () => {
    it("skips hybridRetrieve and still runs trend synthesis on Phase 1 data alone", async () => {
      getFirstSignalCollectedAtMock.mockResolvedValue(daysAgo(10));

      const result = await patternDetectorNode(state);

      expect(hybridRetrieveMock).not.toHaveBeenCalled();
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(result.patterns).toEqual(parsedResult);
    });

    it("also skips hybridRetrieve when getFirstSignalCollectedAt returns undefined", async () => {
      getFirstSignalCollectedAtMock.mockResolvedValue(undefined);

      await patternDetectorNode(state);

      expect(hybridRetrieveMock).not.toHaveBeenCalled();
      expect(invokeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe(">= 90 days of history", () => {
    it("calls hybridRetrieve with the competitor id and topK 150, and its results reach the prompt", async () => {
      getFirstSignalCollectedAtMock.mockResolvedValue(daysAgo(91));
      const chunk = makeChunk();
      hybridRetrieveMock.mockImplementation(async () => {
        callOrder.push("hybridRetrieve");
        return [chunk];
      });

      await patternDetectorNode(state);

      expect(hybridRetrieveMock).toHaveBeenCalledWith(expect.any(String), ["c1"], 150);

      const humanMessage = invokeMock.mock.calls[0][0][1];
      expect(humanMessage[0]).toBe("human");
      expect(humanMessage[1]).toContain(chunk.text);
    });

    it("treats exactly 90 days ago as satisfying the gate", async () => {
      getFirstSignalCollectedAtMock.mockResolvedValue(daysAgo(90));

      await patternDetectorNode(state);

      expect(hybridRetrieveMock).toHaveBeenCalled();
    });
  });

  it("degrades to {} when structured output parsing fails, and never returns patterns", async () => {
    invokeMock.mockImplementation(async () => {
      callOrder.push("invoke");
      return invokeResult({ parsed: null });
    });

    const result = await patternDetectorNode(state);

    expect(result).toEqual({});
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("still tracks cost using the raw usage_metadata even when the call is billed but unparsed", async () => {
    invokeMock.mockResolvedValue(invokeResult({ parsed: null }));

    await patternDetectorNode(state);

    expect(trackCostMock).toHaveBeenCalledWith("pattern_detector", "gpt-4.1", 80, 20, "run1", "c1");
  });

  it("short-circuits to a real stable-trend result (no LLM call) when there's no volume and no retrieved history", async () => {
    getSignalVolumeByDayMock.mockResolvedValue([]);
    getFirstSignalCollectedAtMock.mockResolvedValue(undefined);

    const result = await patternDetectorNode(state);

    expect(result).toEqual({
      patterns: { summary: "No recent signal activity to analyze.", trend: "stable" },
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(chatOpenAIMock).not.toHaveBeenCalled();
    expect(trackCostMock).not.toHaveBeenCalled();
  });

  it("skips the LLM call and returns {} when the daily budget is exhausted", async () => {
    getDailySpendMock.mockResolvedValue(500);

    const result = await patternDetectorNode(state);

    expect(result).toEqual({});
    expect(invokeMock).not.toHaveBeenCalled();
    expect(chatOpenAIMock).not.toHaveBeenCalled();
    expect(trackCostMock).not.toHaveBeenCalled();
  });

  it("degrades to {} (no rethrow) and logs error context when the body throws", async () => {
    getSignalVolumeByDayMock.mockRejectedValue(new Error("db down"));

    const result = await patternDetectorNode(state);

    expect(result).toEqual({});
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("degrading"),
      expect.objectContaining({ agent_name: "pattern_detector", competitor_id: "c1", run_id: "run1" })
    );
  });

  it("passes selectModel's chosen model to ChatOpenAI", async () => {
    selectModelMock.mockResolvedValue("gpt-4.1-alt");

    await patternDetectorNode(state);

    expect(selectModelMock).toHaveBeenCalledWith("gpt-4.1", true);
    expect(chatOpenAIMock).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4.1-alt" }));
  });

  it("uses the active registry prompt when one exists, else SYSTEM_PROMPT_BASE", async () => {
    getActivePromptMock.mockResolvedValue("CUSTOM REGISTRY PROMPT");
    await patternDetectorNode(state);
    let systemMessage = invokeMock.mock.calls[0][0][0];
    expect(systemMessage[1]).toContain("CUSTOM REGISTRY PROMPT");

    invokeMock.mockClear();
    getActivePromptMock.mockResolvedValue(null);
    await patternDetectorNode(state);
    systemMessage = invokeMock.mock.calls[0][0][0];
    expect(systemMessage[1]).toContain("signal volume trend");
  });

  describe("trackLatency spans the whole node, not just the LLM call", () => {
    it("runs Phase 1 SQL, the Phase 2 gate, and the LLM invoke all inside trackLatency's callback (< 90 days)", async () => {
      getFirstSignalCollectedAtMock.mockImplementation(async () => {
        callOrder.push("getFirstSignalCollectedAt");
        return daysAgo(10);
      });

      await patternDetectorNode(state);

      expect(callOrder).toEqual([
        "trackLatency:start",
        "getSignalVolumeByDay",
        "getFirstSignalCollectedAt",
        "invoke",
        "trackLatency:end",
      ]);
    });

    it("runs Phase 1 SQL, Phase 2 retrieval, and the LLM invoke all inside trackLatency's callback (>= 90 days)", async () => {
      getFirstSignalCollectedAtMock.mockImplementation(async () => {
        callOrder.push("getFirstSignalCollectedAt");
        return daysAgo(91);
      });

      await patternDetectorNode(state);

      expect(callOrder).toEqual([
        "trackLatency:start",
        "getSignalVolumeByDay",
        "getFirstSignalCollectedAt",
        "hybridRetrieve",
        "invoke",
        "trackLatency:end",
      ]);
    });
  });
});
