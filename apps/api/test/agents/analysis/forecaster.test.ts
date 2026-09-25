import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  getRecentSignalsByCompetitorIdsMock,
  createPredictionMock,
  listOpenPredictionsMock,
} = vi.hoisted(() => ({
  getRecentSignalsByCompetitorIdsMock: vi.fn(),
  createPredictionMock: vi.fn(),
  listOpenPredictionsMock: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  getRecentSignalsByCompetitorIds: getRecentSignalsByCompetitorIdsMock,
  createPrediction: createPredictionMock,
  listOpenPredictions: listOpenPredictionsMock,
}));

const { getCompanyContextMock } = vi.hoisted(() => ({
  getCompanyContextMock: vi.fn().mockResolvedValue(""),
}));
vi.mock("@/lib/company-context", () => ({ getCompanyContext: getCompanyContextMock }));

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
  ANTHROPIC_MODEL_IDS: { "claude-sonnet": "claude-sonnet-4-20250514" },
}));

const { getActivePromptMock } = vi.hoisted(() => ({
  getActivePromptMock: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/llm/prompt-registry", () => ({ getActivePrompt: getActivePromptMock }));

const { trackLatencyMock } = vi.hoisted(() => ({
  trackLatencyMock: vi.fn((_a: string, _c: unknown, fn: () => unknown) => fn()),
}));
vi.mock("@/lib/latency-tracker", () => ({ trackLatency: trackLatencyMock }));

const { withCircuitBreakerMock } = vi.hoisted(() => ({
  withCircuitBreakerMock: vi.fn((_name: string, fn: () => unknown) => fn()),
}));
vi.mock("@/reliability/circuit-breaker", () => ({
  withCircuitBreaker: withCircuitBreakerMock,
}));

const { structuredInvokeMock, withStructuredOutputMock } = vi.hoisted(() => {
  const structuredInvokeMock = vi.fn();
  const withStructuredOutputMock = vi.fn(() => ({ invoke: structuredInvokeMock }));
  return { structuredInvokeMock, withStructuredOutputMock };
});
vi.mock("@langchain/anthropic", () => {
  class ChatAnthropicMockClass {
    withStructuredOutput = withStructuredOutputMock;
  }
  return { ChatAnthropic: ChatAnthropicMockClass };
});

import { forecasterNode, EVIDENCE_FLOOR } from "@/agents/analysis/forecaster";

const NOW = new Date("2026-09-25T00:00:00.000Z");

const COMPETITOR_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";

// The fields forecasterNode actually reads. Cast at this one boundary rather
// than constructing every nullable branch result the full graph state carries.
const baseState = {
  competitor_id: COMPETITOR_ID,
  workspace_id: WORKSPACE_ID,
  run_id: RUN_ID,
  has_pricing_diff: false,
  is_own_company_run: false,
} as Parameters<typeof forecasterNode>[0];

function makeSignals(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `44444444-4444-4444-8444-4444444444${String(i).padStart(2, "0")}`,
    competitor_id: COMPETITOR_ID,
    source: "github",
    source_url: `https://github.com/acme/next/pull/${i}`,
    title: `PR #${i}`,
    raw_text: `Pull request ${i} touching the storage layer`,
    quality_score: 0.8,
    cluster_id: `55555555-5555-4555-8555-5555555555${String(i).padStart(2, "0")}`,
    collected_at: NOW,
    created_at: NOW,
  }));
}

const validForecast = {
  statement: "Acme ships a first-party Postgres adapter in the next quarter",
  pattern_type: "product_launch" as const,
  probability: 0.72,
  horizon_days: 90,
  resolution_criteria: {
    kind: "github_release" as const,
    repo: "acme/next",
    mentions: ["postgres"],
  },
  reasoning: "Three open pull requests reference a pg driver.",
};

describe("forecaster node", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    listOpenPredictionsMock.mockResolvedValue([]);
    createPredictionMock.mockImplementation(async () => ({ id: "pred-1" }));
    getDailySpendMock.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("abstains without calling the model when evidence is below the floor", async () => {
    // The evidence floor is the anti-noise mechanism in code. Below it the node
    // must not reach for the model at all — a model given four signals will
    // still produce three confident forecasts, which is exactly the failure
    // mode the ledger exists to prevent.
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue(makeSignals(EVIDENCE_FLOOR - 1));

    const out = await forecasterNode(baseState);

    expect(structuredInvokeMock).not.toHaveBeenCalled();
    expect(createPredictionMock).not.toHaveBeenCalled();
    expect(out.forecasts).toEqual([]);
  });

  it("persists a forecast with its evidence set and a computed resolves_at", async () => {
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue(makeSignals(9));
    structuredInvokeMock.mockResolvedValue({
      parsed: { forecasts: [validForecast], abstained_reason: null },
      raw: { usage_metadata: { input_tokens: 100, output_tokens: 50 } },
    });

    await forecasterNode(baseState);

    expect(createPredictionMock).toHaveBeenCalledTimes(1);
    const [row] = createPredictionMock.mock.calls[0];
    expect(row.probability).toBe(0.72);
    expect(row.pattern_type).toBe("product_launch");
    expect(row.evidence_count).toBe(9);
    expect(row.evidence_signal_ids).toHaveLength(9);
    expect(row.status).toBe("open");
    expect(row.workspace_id).toBe(WORKSPACE_ID);
    expect(row.competitor_id).toBe(COMPETITOR_ID);
    // 2026-09-25 + 90 days
    expect(new Date(row.resolves_at).toISOString()).toBe("2026-12-24T00:00:00.000Z");
  });

  it("stores nothing when the model abstains with a reason", async () => {
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue(makeSignals(9));
    structuredInvokeMock.mockResolvedValue({
      parsed: { forecasts: [], abstained_reason: "Activity is routine maintenance." },
      raw: { usage_metadata: { input_tokens: 100, output_tokens: 10 } },
    });

    const out = await forecasterNode(baseState);

    expect(createPredictionMock).not.toHaveBeenCalled();
    expect(out.forecasts).toEqual([]);
  });

  it("tracks cost even when the structured output fails to parse", async () => {
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue(makeSignals(9));
    structuredInvokeMock.mockResolvedValue({
      parsed: null,
      raw: { usage_metadata: { input_tokens: 100, output_tokens: 50 } },
    });

    await forecasterNode(baseState);

    // The call was made and billed whether or not it parsed.
    expect(trackCostMock).toHaveBeenCalled();
    expect(createPredictionMock).not.toHaveBeenCalled();
  });

  it("degrades to an empty result rather than aborting the run when the model throws", async () => {
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue(makeSignals(9));
    structuredInvokeMock.mockRejectedValue(new Error("anthropic is down"));

    const out = await forecasterNode(baseState);

    // A forecasting failure must not cost the day's analysis run.
    expect(out).toEqual({});
  });

  it("skips the model when the daily LLM budget is exhausted", async () => {
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue(makeSignals(9));
    getDailySpendMock.mockResolvedValue(1_000);

    await forecasterNode(baseState);

    expect(structuredInvokeMock).not.toHaveBeenCalled();
    expect(createPredictionMock).not.toHaveBeenCalled();
  });

  it("counts distinct clusters, not raw signals, against the floor", async () => {
    // Ten copies of one story is one piece of evidence. Counting rows instead of
    // clusters would let a single noisy thread clear the floor on its own.
    const signals = makeSignals(10).map((s) => ({ ...s, cluster_id: "shared-cluster" }));
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue(signals);

    const out = await forecasterNode(baseState);

    expect(structuredInvokeMock).not.toHaveBeenCalled();
    expect(out.forecasts).toEqual([]);
  });
});
