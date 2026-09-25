import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getSignalVolumeByDayMock,
  getRecentPricingDiffsMock,
  getLatestSignalScoresMock,
  createSignalScoreMock,
  createAlertMock,
  completeAgentRunMock,
} = vi.hoisted(() => ({
  getSignalVolumeByDayMock: vi.fn(),
  getRecentPricingDiffsMock: vi.fn(),
  getLatestSignalScoresMock: vi.fn(),
  createSignalScoreMock: vi.fn(),
  // anthropicResult()'s default decision is "alert" (see below), so most tests in this file
  // exercise the alert-persist branch whether or not they care about its output.
  createAlertMock: vi.fn().mockResolvedValue({
    id: "alert-1",
    competitor_id: "competitor-1",
    pattern: "Score jumped and the window is open.",
    confidence: 0.5,
  }),
  completeAgentRunMock: vi.fn(),
}));

// Slack delivery is best-effort by construction (it swallows every failure and
// returns void), so these suites stub it out rather than assert on it — its own
// behaviour is covered in test/integrations/slack/delivery.test.ts.
vi.mock("@/integrations/slack/delivery", () => ({
  deliverAlertToSlack: vi.fn().mockResolvedValue(undefined),
  deliverPredictionToSlack: vi.fn().mockResolvedValue(undefined),
  deliverResolutionToSlack: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/db/queries", () => ({
  getCompetitorById: vi.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
  getSignalVolumeByDay: getSignalVolumeByDayMock,
  getRecentPricingDiffs: getRecentPricingDiffsMock,
  getLatestSignalScores: getLatestSignalScoresMock,
  createSignalScore: createSignalScoreMock,
  createAlert: createAlertMock,
  completeAgentRun: completeAgentRunMock,
}));

const { publishSocketEventMock } = vi.hoisted(() => ({
  publishSocketEventMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/socket-relay", () => ({ publishSocketEvent: publishSocketEventMock }));

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
  ANTHROPIC_MODEL_IDS: {
    "claude-haiku": "claude-haiku-4-5-20251001",
    "claude-sonnet": "claude-sonnet-5",
  },
}));

const { getActivePromptMock } = vi.hoisted(() => ({
  getActivePromptMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/llm/prompt-registry", () => ({ getActivePrompt: getActivePromptMock }));

const { trackLatencyMock } = vi.hoisted(() => ({
  trackLatencyMock: vi.fn(
    (_a: string, _context: unknown, fn: () => unknown) => fn()
  ),
}));

vi.mock("@/lib/latency-tracker", () => ({ trackLatency: trackLatencyMock }));

const { anthropicInvokeMock, chatAnthropicMock } = vi.hoisted(() => {
  const anthropicInvokeMock = vi.fn();
  const withStructuredOutputMock = vi.fn(() => ({ invoke: anthropicInvokeMock }));
  class ChatAnthropicMockClass {
    withStructuredOutput = withStructuredOutputMock;
  }
  return { anthropicInvokeMock, chatAnthropicMock: vi.fn(ChatAnthropicMockClass) };
});

vi.mock("@langchain/anthropic", () => ({ ChatAnthropic: chatAnthropicMock }));

const { withCircuitBreakerMock } = vi.hoisted(() => ({
  withCircuitBreakerMock: vi.fn((_service: string, fn: () => unknown) => fn()),
}));

vi.mock("@/reliability/circuit-breaker", () => ({
  withCircuitBreaker: withCircuitBreakerMock,
}));

import { synthesisNode } from "@/agents/analysis/synthesis";

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const daysAgoISO = (n: number) => new Date(NOW - n * DAY).toISOString();

function fullState() {
  return {
    competitor_id: "c1",
    run_id: "run1",
    has_pricing_diff: true,
    hiring_intent: { summary: "Hiring 5 senior AEs.", intent_level: "high" as const },
    sentiment_clusters: {
      summary: "Mixed.",
      new_complaints: ["slow support"],
      chronic_complaints: ["buggy exports", "pricing opacity", "flaky API"],
    },
    pricing_change: { summary: "Enterprise tier up 20%.", old_price: "$400", new_price: "$480" },
    patterns: { summary: "Volume rising.", trend: "increasing" as const },
    vulnerability: { summary: "Support regression.", window_open: true, positioning_copy: "..." },
    signal_score: null,
    decision: null,
  } as never;
}

function anthropicResult(
  overrides: Partial<{ raw: Record<string, unknown>; parsed: unknown }> = {}
) {
  return {
    raw: { usage_metadata: { input_tokens: 40, output_tokens: 12 } },
    parsed: { action: "alert", reason: "Score jumped and the window is open." },
    ...overrides,
  };
}

describe("agents/analysis/synthesis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // recent7 = 30 (ages 1,2,3), prior7 = 15 (ages 8,9,10)
    getSignalVolumeByDayMock.mockResolvedValue([
      { day: daysAgoISO(10), count: 5, weighted_count: 5 },
      { day: daysAgoISO(9), count: 5, weighted_count: 5 },
      { day: daysAgoISO(8), count: 5, weighted_count: 5 },
      { day: daysAgoISO(3), count: 10, weighted_count: 10 },
      { day: daysAgoISO(2), count: 10, weighted_count: 10 },
      { day: daysAgoISO(1), count: 10, weighted_count: 10 },
    ]);
    getRecentPricingDiffsMock.mockResolvedValue([
      { id: "d1", competitor_id: "c1", detected_at: new Date(NOW - 1 * DAY), diff: {}, significance: "moderate" },
    ]);
    getLatestSignalScoresMock.mockResolvedValue([]);
    createSignalScoreMock.mockImplementation((input) =>
      Promise.resolve({
        id: "score-1",
        competitor_id: input.competitor_id,
        score: input.score,
        components: input.components,
        delta_7d: input.delta_7d ?? null,
        delta_30d: input.delta_30d ?? null,
        computed_at: new Date(),
      })
    );
    completeAgentRunMock.mockResolvedValue(undefined);
    getCompanyContextMock.mockResolvedValue("");
    selectModelMock.mockImplementation((m: string) => Promise.resolve(m));
    trackCostMock.mockResolvedValue(0);
    getDailySpendMock.mockResolvedValue(0);
    getDailyBudgetMock.mockReturnValue(100);
    getActivePromptMock.mockResolvedValue(null);
    anthropicInvokeMock.mockResolvedValue(anthropicResult());
    trackLatencyMock.mockImplementation((_a: string, _context: unknown, fn: () => unknown) => fn());
  });

  it("full happy path: computes components, persists a sane score, closes the run, returns state", async () => {
    const result = await synthesisNode(fullState());

    expect(createSignalScoreMock).toHaveBeenCalledTimes(1);
    const payload = createSignalScoreMock.mock.calls[0][0];
    expect(payload.competitor_id).toBe("c1");
    expect(Number.isInteger(payload.score)).toBe(true);
    expect(payload.score).toBeGreaterThanOrEqual(0);
    expect(payload.score).toBeLessThanOrEqual(100);

    // mention_velocity clamps (30-15)/15 = 1; sentiment (3-1)*-1/4 = -0.5; hiring high = 1;
    // pricing diff ~1 day old with a 14-day half-life ≈ 0.95.
    expect(payload.components.mention_velocity).toBe(1);
    expect(payload.components.sentiment_trajectory).toBe(-0.5);
    expect(payload.components.hiring_momentum).toBe(1);
    expect(payload.components.pricing_change_recency).toBeGreaterThan(0.9);
    expect(payload.components.pricing_change_recency).toBeLessThanOrEqual(1);
    expect(payload.components.vulnerability_window_status).toBe("open");
    for (const key of [
      "mention_velocity",
      "sentiment_trajectory",
      "hiring_momentum",
      "pricing_change_recency",
    ] as const) {
      expect(Number.isFinite(payload.components[key])).toBe(true);
    }

    expect(chatAnthropicMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-5", maxRetries: 2 })
    );
    expect(selectModelMock).toHaveBeenCalledWith("claude-sonnet", true);
    expect(trackCostMock).toHaveBeenCalledWith(
      "synthesis",
      "claude-sonnet",
      40,
      12,
      { competitorId: "c1", identity: { kind: "run", runId: "run1" } }
    );

    expect(completeAgentRunMock).toHaveBeenCalledWith("run1", "completed", "alert");
    // completeAgentRun is the last write — after the score is persisted.
    expect(createSignalScoreMock.mock.invocationCallOrder[0]).toBeLessThan(
      completeAgentRunMock.mock.invocationCallOrder[0]
    );

    expect(result.decision).toEqual({ action: "alert", reason: "Score jumped and the window is open." });
    expect(result.signal_score).toMatchObject({ id: "score-1", competitor_id: "c1", score: payload.score });
  });

  it("wraps the decision LLM call in withCircuitBreaker under analysis:synthesis", async () => {
    await synthesisNode(fullState());
    expect(withCircuitBreakerMock).toHaveBeenCalledWith(
      "analysis:synthesis",
      expect.any(Function)
    );
  });

  it.each(["alert", "digest", "suppress"] as const)(
    "routes the LLM's %s action through to completeAgentRun",
    async (action) => {
      anthropicInvokeMock.mockResolvedValue(anthropicResult({ parsed: { action, reason: "r" } }));

      const result = await synthesisNode(fullState());

      expect(completeAgentRunMock).toHaveBeenCalledWith("run1", "completed", action);
      expect(result.decision).toEqual({ action, reason: "r" });
    }
  );

  it("delta selection: no prior scores → both deltas null", async () => {
    getLatestSignalScoresMock.mockResolvedValue([]);

    await synthesisNode(fullState());

    const payload = createSignalScoreMock.mock.calls[0][0];
    expect(payload.delta_7d).toBeNull();
    expect(payload.delta_30d).toBeNull();
  });

  it("delta selection: a ~7-day-old prior score → delta_7d is the real diff, delta_30d still null", async () => {
    getLatestSignalScoresMock.mockResolvedValue([
      { id: "old", competitor_id: "c1", score: 40, components: {}, delta_7d: null, delta_30d: null, computed_at: new Date(NOW - 7 * DAY) },
    ]);

    await synthesisNode(fullState());

    const payload = createSignalScoreMock.mock.calls[0][0];
    expect(payload.delta_7d).toBe(payload.score - 40);
    expect(payload.delta_30d).toBeNull();
  });

  it("delta selection: only rows younger than the 7d tolerance → delta_7d null (not a spurious too-fresh baseline)", async () => {
    getLatestSignalScoresMock.mockResolvedValue([
      { id: "d1", competitor_id: "c1", score: 30, components: {}, delta_7d: null, delta_30d: null, computed_at: new Date(NOW - 1 * DAY) },
      { id: "d2", competitor_id: "c1", score: 32, components: {}, delta_7d: null, delta_30d: null, computed_at: new Date(NOW - 3 * DAY) },
    ]);

    await synthesisNode(fullState());

    const payload = createSignalScoreMock.mock.calls[0][0];
    expect(payload.delta_7d).toBeNull();
    expect(payload.delta_30d).toBeNull();
  });

  it("null components stay finite numbers and do not throw", async () => {
    const state = fullState() as unknown as Record<string, unknown>;
    state.sentiment_clusters = null;
    state.hiring_intent = null;
    state.pricing_change = null;
    getRecentPricingDiffsMock.mockResolvedValue([]);

    const result = await synthesisNode(state as never);

    const payload = createSignalScoreMock.mock.calls[0][0];
    expect(payload.components.sentiment_trajectory).toBe(0);
    expect(payload.components.hiring_momentum).toBe(0);
    expect(payload.components.pricing_change_recency).toBe(0);
    expect(Number.isFinite(payload.components.mention_velocity)).toBe(true);
    expect(result.decision).toBeDefined();
  });

  it("vulnerability null → window status 'none'", async () => {
    const state = fullState() as unknown as Record<string, unknown>;
    state.vulnerability = null;

    await synthesisNode(state as never);

    expect(createSignalScoreMock.mock.calls[0][0].components.vulnerability_window_status).toBe("none");
  });

  it("throws when the decision structured output fails schema validation, before persisting or closing the run", async () => {
    anthropicInvokeMock.mockResolvedValue(anthropicResult({ parsed: null }));

    await expect(synthesisNode(fullState())).rejects.toThrow(/schema validation/);

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("decision structured output"),
      expect.objectContaining({ competitor_id: "c1", run_id: "run1" })
    );
    // H2 step 1: the score INSERT must not happen until the decision call succeeds — a
    // failure here leaves no orphan score row for a job retry to duplicate.
    expect(createSignalScoreMock).not.toHaveBeenCalled();
    expect(completeAgentRunMock).not.toHaveBeenCalled();
    // The call was still billed.
    expect(trackCostMock).toHaveBeenCalledTimes(1);
  });

  it("budget exhausted: skips the ChatAnthropic call, still persists the score, closes the run as digest", async () => {
    getDailySpendMock.mockResolvedValue(500);

    const result = await synthesisNode(fullState());

    expect(chatAnthropicMock).not.toHaveBeenCalled();
    expect(anthropicInvokeMock).not.toHaveBeenCalled();
    expect(trackCostMock).not.toHaveBeenCalled();

    expect(createSignalScoreMock).toHaveBeenCalledTimes(1);
    expect(completeAgentRunMock).toHaveBeenCalledWith("run1", "completed", "digest");
    expect(result.decision?.action).toBe("digest");
    expect(result.decision?.reason).toMatch(/budget/i);
    expect(result.signal_score).toMatchObject({ competitor_id: "c1" });
  });

  it("wires the active registry prompt into the decision system message when one exists", async () => {
    getActivePromptMock.mockResolvedValue("CUSTOM REGISTRY PROMPT");

    await synthesisNode(fullState());

    const [messages] = anthropicInvokeMock.mock.calls[0];
    const [systemMessage] = messages as [string, string][];
    expect(systemMessage[1]).toContain("CUSTOM REGISTRY PROMPT");
  });

  it("buildAlertInput: uses decision.detail's model-authored fields for the created alert when present", async () => {
    anthropicInvokeMock.mockResolvedValue(
      anthropicResult({
        parsed: {
          action: "alert",
          reason: "Score jumped and the window is open.",
          detail: {
            pattern: "Hiring surge meets an open support-quality window",
            interpretation:
              "Five senior AE hires plus a widened support regression window is a near-term acquisition risk.",
            evidence: [
              { type: "hiring", summary: "5 senior AE postings opened this week." },
              { type: "vulnerability", summary: "Support regression widened the window." },
            ],
            recommended_actions: [
              { action: "Brief sales on the support regression talking point." },
            ],
          },
        },
      })
    );

    await synthesisNode(fullState());

    expect(createAlertMock).toHaveBeenCalledTimes(1);
    const alertInput = createAlertMock.mock.calls[0][0];
    expect(alertInput.pattern).toBe("Hiring surge meets an open support-quality window");
    expect(alertInput.interpretation).toBe(
      "Five senior AE hires plus a widened support regression window is a near-term acquisition risk."
    );
    expect(alertInput.evidence).toEqual([
      { type: "hiring", summary: "5 senior AE postings opened this week." },
      { type: "vulnerability", summary: "Support regression widened the window." },
    ]);
    expect(alertInput.recommended_actions).toEqual([
      { action: "Brief sales on the support regression talking point." },
    ]);
  });

  it("buildAlertInput: falls back to the heuristic derivation when action is alert but detail is absent", async () => {
    // anthropicResult()'s default parsed value has no `detail` key at all.
    anthropicInvokeMock.mockResolvedValue(anthropicResult());

    await synthesisNode(fullState());

    expect(createAlertMock).toHaveBeenCalledTimes(1);
    const alertInput = createAlertMock.mock.calls[0][0];
    // Falls back to the decision's one-sentence reason as the pattern label.
    expect(alertInput.pattern).toBe("Score jumped and the window is open.");
    // Falls back to the full LLM context text.
    expect(alertInput.interpretation).toContain("Signal Score:");
    expect(alertInput.interpretation).toContain("Agent summaries:");
    // Falls back to a mechanical dump of every non-null branch-node summary.
    expect(alertInput.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "hiring" }),
        expect.objectContaining({ type: "sentiment" }),
        expect.objectContaining({ type: "pricing" }),
        expect.objectContaining({ type: "pattern" }),
        expect.objectContaining({ type: "vulnerability" }),
      ])
    );
    // Falls back to the vulnerability window's positioning copy as the sole recommended action.
    expect(alertInput.recommended_actions).toEqual([{ action: "..." }]);
  });

  it("buildAlertInput: falls back to the heuristic derivation when detail is present but evidence/recommended_actions are empty", async () => {
    // AlertDetailSchema allows an empty evidence/recommended_actions list (no .min()) — a
    // model can validly write a good pattern/interpretation but leave the structured lists
    // empty. `??` alone would only fall through on null/undefined, not [], so this would
    // silently discard real derivable data without the .length check in buildAlertInput.
    anthropicInvokeMock.mockResolvedValue(
      anthropicResult({
        parsed: {
          action: "alert",
          reason: "Score jumped and the window is open.",
          detail: {
            pattern: "Model-authored headline",
            interpretation: "Model-authored interpretation.",
            evidence: [],
            recommended_actions: [],
          },
        },
      })
    );

    await synthesisNode(fullState());

    const alertInput = createAlertMock.mock.calls[0][0];
    // pattern/interpretation still prefer detail's model-authored fields.
    expect(alertInput.pattern).toBe("Model-authored headline");
    expect(alertInput.interpretation).toBe("Model-authored interpretation.");
    // evidence/recommended_actions fall back to the mechanical derivation, not [].
    expect(alertInput.evidence.length).toBeGreaterThan(0);
    expect(alertInput.recommended_actions).toEqual([{ action: "..." }]);
  });

  it("translates a runtime downgrade to claude-haiku for the constructor, alias for trackCost", async () => {
    selectModelMock.mockImplementation((m: string) =>
      Promise.resolve(m === "claude-sonnet" ? "claude-haiku" : m)
    );

    await synthesisNode(fullState());

    expect(chatAnthropicMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5-20251001" })
    );
    expect(trackCostMock).toHaveBeenCalledWith(
      "synthesis",
      "claude-haiku",
      40,
      12,
      { competitorId: "c1", identity: { kind: "run", runId: "run1" } }
    );
  });
});
