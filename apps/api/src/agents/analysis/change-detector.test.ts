import { describe, it, expect, vi, beforeEach } from "vitest";

const { getRecentPricingDiffsMock } = vi.hoisted(() => ({
  getRecentPricingDiffsMock: vi.fn(),
}));

vi.mock("../../db/queries", () => ({
  getRecentPricingDiffs: getRecentPricingDiffsMock,
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
  // Real class as the mock implementation (same pattern as intent-analyzer.test.ts) —
  // an arrow-function mockImplementation can't be `new`'d, which is exactly what
  // change-detector.ts does with ChatOpenAI.
  class ChatOpenAIMockClass {
    withStructuredOutput = withStructuredOutputMock;
  }
  const chatOpenAIMock = vi.fn(ChatOpenAIMockClass);
  return { invokeMock, withStructuredOutputMock, chatOpenAIMock };
});

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: chatOpenAIMock,
}));

import { changeDetectorNode } from "./change-detector";

const state = {
  competitor_id: "c1",
  run_id: "run1",
  has_pricing_diff: true,
  hiring_intent: null,
  sentiment_clusters: null,
  pricing_change: null,
  patterns: null,
  vulnerability: null,
  signal_score: null,
  decision: null,
} as never;

function makeDiff(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "d1",
    competitor_id: "c1",
    baseline_id: "b1",
    diff: { added: ["Pro tier: $49/mo"], removed: ["Pro tier: $39/mo"] },
    significance: "moderate",
    detected_at: new Date("2026-09-01T00:00:00Z"),
    created_at: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

const parsedResult = {
  summary: "Pro tier price increased.",
  old_price: "$39/mo",
  new_price: "$49/mo",
};

function invokeResult(overrides: Partial<{ raw: Record<string, unknown>; parsed: unknown }> = {}) {
  return {
    raw: { usage_metadata: { input_tokens: 50, output_tokens: 10 } },
    parsed: parsedResult,
    ...overrides,
  };
}

describe("agents/analysis/change-detector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentPricingDiffsMock.mockResolvedValue([makeDiff()]);
    getCompanyContextMock.mockResolvedValue("");
    trackCostMock.mockResolvedValue(0);
    invokeMock.mockResolvedValue(invokeResult());
    trackLatencyMock.mockImplementation(
      (_a: string, _c: string, _r: string, fn: () => unknown) => fn()
    );
  });

  it("logs a warning and returns a true no-op (no LLM call) when there are no recent pricing diffs", async () => {
    getRecentPricingDiffsMock.mockResolvedValue([]);

    const result = await changeDetectorNode(state);

    expect(result).toEqual({});
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("no recent pricing diffs found"),
      expect.objectContaining({ competitor_id: "c1", run_id: "run1" })
    );
    expect(chatOpenAIMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(trackCostMock).not.toHaveBeenCalled();
  });

  it("queries recent pricing diffs for the competitor over the last 7 days", async () => {
    await changeDetectorNode(state);

    expect(getRecentPricingDiffsMock).toHaveBeenCalledWith("c1", 7);
  });

  it("selects the critical diff over a more recent minor/moderate diff (severity beats recency)", async () => {
    const criticalDiff = makeDiff({
      id: "d-critical",
      significance: "critical",
      diff: { added: ["Enterprise tier: $999/mo"], removed: ["Enterprise tier: $799/mo"] },
      detected_at: new Date("2026-08-25T00:00:00Z"), // older
    });
    const moderateDiff = makeDiff({
      id: "d-moderate",
      significance: "moderate",
      diff: { added: ["Pro tier: $49/mo"], removed: ["Pro tier: $39/mo"] },
      detected_at: new Date("2026-09-01T00:00:00Z"), // newer
    });
    const minorDiff = makeDiff({
      id: "d-minor",
      significance: "minor",
      diff: { added: ["Updated FAQ copy"], removed: ["Old FAQ copy"] },
      detected_at: new Date("2026-09-02T00:00:00Z"), // newest
    });
    // Ordered detected_at desc, as the real getRecentPricingDiffs query returns.
    getRecentPricingDiffsMock.mockResolvedValue([minorDiff, moderateDiff, criticalDiff]);

    await changeDetectorNode(state);

    const [messages] = invokeMock.mock.calls[0];
    const [, humanMessage] = messages as [string, string][];
    expect(humanMessage[1]).toContain("Enterprise tier: $999/mo");
    expect(humanMessage[1]).not.toContain("Pro tier: $49/mo");
    expect(humanMessage[1]).not.toContain("Updated FAQ copy");
  });

  it("keeps the existing detected_at-desc order as a stable tie-break among same-severity diffs", async () => {
    const olderModerate = makeDiff({
      id: "d-older-moderate",
      significance: "moderate",
      diff: { added: ["older moderate added"], removed: [] },
      detected_at: new Date("2026-08-20T00:00:00Z"),
    });
    const newerModerate = makeDiff({
      id: "d-newer-moderate",
      significance: "moderate",
      diff: { added: ["newer moderate added"], removed: [] },
      detected_at: new Date("2026-09-05T00:00:00Z"),
    });
    // Already detected_at desc, as the real query returns — newer first.
    getRecentPricingDiffsMock.mockResolvedValue([newerModerate, olderModerate]);

    await changeDetectorNode(state);

    const [messages] = invokeMock.mock.calls[0];
    const [, humanMessage] = messages as [string, string][];
    expect(humanMessage[1]).toContain("newer moderate added");
    expect(humanMessage[1]).not.toContain("older moderate added");
  });

  it("calls gpt-4o-mini via ChatOpenAI with structured output over the selected diff's added/removed lines, extracting old_price/new_price", async () => {
    getRecentPricingDiffsMock.mockResolvedValue([
      makeDiff({ diff: { added: ["Pro tier: $49/mo"], removed: ["Pro tier: $39/mo"] } }),
    ]);

    const result = await changeDetectorNode(state);

    expect(chatOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini", timeout: 30_000, maxRetries: 2 })
    );
    expect(withStructuredOutputMock).toHaveBeenCalledWith(expect.anything(), { includeRaw: true });
    const [messages] = invokeMock.mock.calls[0];
    const [, humanMessage] = messages as [string, string][];
    expect(humanMessage[1]).toContain("Pro tier: $49/mo");
    expect(humanMessage[1]).toContain("Pro tier: $39/mo");
    expect(result).toEqual({ pricing_change: parsedResult });
    expect(result.pricing_change?.old_price).toBe("$39/mo");
    expect(result.pricing_change?.new_price).toBe("$49/mo");
  });

  it("narrows a malformed diff jsonb payload to empty added/removed arrays instead of throwing", async () => {
    getRecentPricingDiffsMock.mockResolvedValue([makeDiff({ diff: { added: "not-an-array" } })]);

    await expect(changeDetectorNode(state)).resolves.toEqual({ pricing_change: parsedResult });
  });

  it("injects company context into the system prompt when a profile exists", async () => {
    getCompanyContextMock.mockResolvedValue("ABOUT THE USER'S COMPANY:\nProduct: Signal");

    await changeDetectorNode(state);

    const [messages] = invokeMock.mock.calls[0];
    const [systemMessage] = messages as [string, string][];
    expect(systemMessage[1]).toContain("ABOUT THE USER'S COMPANY:");
  });

  it("wraps the LLM invocation in trackLatency with change_detector/competitor_id/run_id", async () => {
    await changeDetectorNode(state);

    expect(trackLatencyMock).toHaveBeenCalledWith("change_detector", "c1", "run1", expect.any(Function));
  });

  it("tracks cost using the real token counts and model name", async () => {
    invokeMock.mockResolvedValue(
      invokeResult({ raw: { usage_metadata: { input_tokens: 200, output_tokens: 40 } } })
    );

    await changeDetectorNode(state);

    expect(trackCostMock).toHaveBeenCalledWith("change_detector", "gpt-4o-mini", 200, 40, "run1", "c1");
  });

  it("throws when structured output fails schema validation (parsed is null)", async () => {
    invokeMock.mockResolvedValue(invokeResult({ parsed: null }));

    await expect(changeDetectorNode(state)).rejects.toThrow(/schema validation/);

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("schema validation"),
      expect.objectContaining({ competitor_id: "c1", run_id: "run1" })
    );
  });
});
