import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  listCompetitorsForWorkspaceMock,
  getRecentSignalsByCompetitorIdsMock,
  getLatestSignalScoresMock,
  createAlertMock,
} = vi.hoisted(() => ({
  listCompetitorsForWorkspaceMock: vi.fn(),
  getRecentSignalsByCompetitorIdsMock: vi.fn(),
  getLatestSignalScoresMock: vi.fn(),
  createAlertMock: vi.fn().mockResolvedValue({
    id: "alert-1",
    competitor_id: "own-company-1",
    pattern: "headline",
    confidence: 0.5,
  }),
}));

vi.mock("@/db/queries", () => ({
  listCompetitorsForWorkspace: listCompetitorsForWorkspaceMock,
  getRecentSignalsByCompetitorIds: getRecentSignalsByCompetitorIdsMock,
  getLatestSignalScores: getLatestSignalScoresMock,
  createAlert: createAlertMock,
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
  trackLatencyMock: vi.fn((_a: string, _context: unknown, fn: () => unknown) => fn()),
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

import { comparativeSynthesisNode } from "@/agents/analysis/comparative-synthesis";

const OWN_COMPETITOR = "own-company-1";

function realCompetitors() {
  return [
    { id: "competitor-a", name: "Alpha", domain: "alpha.com", is_own_company: false, is_active: true },
    { id: "competitor-b", name: "Beta", domain: "beta.com", is_own_company: false, is_active: true },
  ] as never[];
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    competitor_id: OWN_COMPETITOR,
    workspace_id: "workspace-1",
    run_id: "run-1",
    has_pricing_diff: false,
    is_own_company_run: true,
    signal_score: { score: 62 } as never,
    decision: { action: "digest", reason: "Routine movement." },
    comparative_synthesis: null,
    ...overrides,
  } as never;
}

function parsedResult() {
  return {
    headline: "Alpha and Beta shipped enterprise SSO; we have not.",
    summary: "Both tracked competitors shipped features we lack.",
    observations: [
      { competitor_name: "Alpha", what_they_did: "Shipped enterprise SSO this week." },
      { competitor_name: "Beta", what_they_did: "Launched a free tier." },
    ],
    gaps: [
      {
        gap: "No enterprise SSO",
        possible_reasons: ["Focused on SMB", "SSO backlogged"],
        possible_responses: ["Prioritize SSO", "Partner with Okta"],
      },
    ],
  };
}

function anthropicResult(parsed: unknown) {
  return { raw: { usage_metadata: { input_tokens: 40, output_tokens: 12 } }, parsed };
}

describe("agents/analysis/comparative-synthesis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCompetitorsForWorkspaceMock.mockResolvedValue(realCompetitors());
    getRecentSignalsByCompetitorIdsMock.mockResolvedValue([
      { id: "s1", competitor_id: "competitor-a", source: "changelog", title: "Shipped SSO", raw_text: "..." },
    ]);
    getLatestSignalScoresMock.mockResolvedValue([{ score: 70 }]);
    getCompanyContextMock.mockResolvedValue("");
    selectModelMock.mockImplementation((m: string) => Promise.resolve(m));
    trackCostMock.mockResolvedValue(0);
    getDailySpendMock.mockResolvedValue(0);
    getDailyBudgetMock.mockReturnValue(100);
    getActivePromptMock.mockResolvedValue(null);
    anthropicInvokeMock.mockResolvedValue(anthropicResult(parsedResult()));
    trackLatencyMock.mockImplementation((_a: string, _context: unknown, fn: () => unknown) => fn());
  });

  it("persists an alert mapped per R5 and returns the parsed output in state", async () => {
    const result = await comparativeSynthesisNode(state());

    expect(listCompetitorsForWorkspaceMock).toHaveBeenCalledWith("workspace-1");
    expect(createAlertMock).toHaveBeenCalledTimes(1);
    const alertInput = createAlertMock.mock.calls[0][0];

    expect(alertInput.competitor_id).toBe(OWN_COMPETITOR);
    expect(alertInput.run_id).toBe("run-1");
    expect(alertInput.pattern).toBe("Alpha and Beta shipped enterprise SSO; we have not.");
    expect(alertInput.confidence).toBe(0.5);
    expect(alertInput.vulnerability_window_days).toBeNull();
    expect(alertInput.supporting_cluster_ids).toEqual([]);
    // interpretation = summary + per-gap reasons prose
    expect(alertInput.interpretation).toContain("Both tracked competitors shipped features we lack.");
    expect(alertInput.interpretation).toContain("Focused on SMB");
    // evidence = the observations
    expect(alertInput.evidence).toEqual([
      { competitor_name: "Alpha", what_they_did: "Shipped enterprise SSO this week." },
      { competitor_name: "Beta", what_they_did: "Launched a free tier." },
    ]);
    // recommended_actions = possible_responses flattened to { action }
    expect(alertInput.recommended_actions).toEqual([
      { action: "Prioritize SSO" },
      { action: "Partner with Okta" },
    ]);

    expect(result.comparative_synthesis).toEqual(parsedResult());
  });

  it("uses the same bounded ChatAnthropic + trackCost/trackLatency pattern as synthesis", async () => {
    await comparativeSynthesisNode(state());

    expect(selectModelMock).toHaveBeenCalledWith("claude-sonnet", true);
    expect(chatAnthropicMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-5", maxRetries: 2 })
    );
    expect(trackCostMock).toHaveBeenCalledWith(
      "comparative_synthesis",
      "claude-sonnet",
      40,
      12,
      { competitorId: OWN_COMPETITOR, identity: { kind: "run", runId: "run-1" } }
    );
  });

  it("short-circuits to {} with no alert when the workspace has no other active competitors", async () => {
    listCompetitorsForWorkspaceMock.mockResolvedValue([
      { id: OWN_COMPETITOR, name: "Us", domain: "us.com", is_own_company: true, is_active: true },
    ] as never[]);

    const result = await comparativeSynthesisNode(state());

    expect(result).toEqual({});
    expect(anthropicInvokeMock).not.toHaveBeenCalled();
    expect(createAlertMock).not.toHaveBeenCalled();
  });

  it("degrades to {} with no alert when the DB query throws (R7)", async () => {
    listCompetitorsForWorkspaceMock.mockRejectedValue(new Error("postgres unavailable"));

    const result = await comparativeSynthesisNode(state());

    expect(result).toEqual({});
    expect(createAlertMock).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("comparative_synthesis"),
      expect.objectContaining({ competitor_id: OWN_COMPETITOR, run_id: "run-1" })
    );
  });

  it("degrades to {} with no alert when the structured output fails schema validation", async () => {
    anthropicInvokeMock.mockResolvedValue(anthropicResult(null));

    const result = await comparativeSynthesisNode(state());

    expect(result).toEqual({});
    expect(createAlertMock).not.toHaveBeenCalled();
    expect(trackCostMock).toHaveBeenCalledTimes(1);
  });

  it("degrades to {} when createAlert throws (R7)", async () => {
    createAlertMock.mockRejectedValue(new Error("constraint violation"));

    const result = await comparativeSynthesisNode(state());

    expect(result).toEqual({});
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("degrades to {} without an LLM call when the daily budget is exhausted", async () => {
    getDailySpendMock.mockResolvedValue(500);

    const result = await comparativeSynthesisNode(state());

    expect(result).toEqual({});
    expect(anthropicInvokeMock).not.toHaveBeenCalled();
    expect(createAlertMock).not.toHaveBeenCalled();
  });
});
