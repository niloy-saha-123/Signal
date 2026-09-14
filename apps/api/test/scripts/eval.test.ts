import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentName } from "@signal/shared";
import {
  comparePromptResults,
  invokeDefaultCandidate,
  runEvalCli,
  runPromptEvaluation,
  type AgentTestCase,
  type PromptEvaluationRequest,
  type PromptEvaluationDeps,
  type PromptVersionCandidate,
} from "../../scripts/eval";
import {
  HiringIntentSchema,
  VulnerabilityPositioningSchema,
  VulnerabilityWindowSchema,
} from "../../src/agents/analysis/contracts";

const providerMocks = vi.hoisted(() => {
  const openAiInvoke = vi.fn();
  const anthropicInvoke = vi.fn();
  const openAiWithStructuredOutput = vi.fn(() => ({ invoke: openAiInvoke }));
  const anthropicWithStructuredOutput = vi.fn(() => ({ invoke: anthropicInvoke }));
  const openAiConstructor = vi.fn(function (_options: unknown) {
    return { withStructuredOutput: openAiWithStructuredOutput };
  });
  const anthropicConstructor = vi.fn(function (_options: unknown) {
    return { withStructuredOutput: anthropicWithStructuredOutput };
  });
  const trackLatency = vi.fn(
    async (_agentName: unknown, _telemetry: unknown, operation: () => Promise<unknown>) =>
      operation()
  );
  return {
    openAiInvoke,
    anthropicInvoke,
    openAiWithStructuredOutput,
    anthropicWithStructuredOutput,
    openAiConstructor,
    anthropicConstructor,
    trackLatency,
    trackCost: vi.fn(async () => 0),
    getDailySpend: vi.fn(async () => 0),
    getDailyBudget: vi.fn(() => 2),
    selectModel: vi.fn(async (model: string) => model),
    getCompanyContext: vi.fn(async () => "COMPANY CONTEXT"),
    getActivePrompt: vi.fn(),
  };
});

vi.mock("@langchain/openai", () => ({ ChatOpenAI: providerMocks.openAiConstructor }));
vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: providerMocks.anthropicConstructor,
}));
vi.mock("../../src/lib/latency-tracker", () => ({
  trackLatency: providerMocks.trackLatency,
}));
vi.mock("../../src/llm/cost-tracker", () => ({
  trackCost: providerMocks.trackCost,
  getDailySpend: providerMocks.getDailySpend,
}));
vi.mock("../../src/llm/adaptive-router", () => ({
  selectModel: providerMocks.selectModel,
  getDailyBudget: providerMocks.getDailyBudget,
  ANTHROPIC_MODEL_IDS: {
    "claude-haiku": "anthropic-haiku-id",
    "claude-sonnet": "anthropic-sonnet-id",
  },
}));
vi.mock("../../src/lib/company-context", () => ({
  getCompanyContext: providerMocks.getCompanyContext,
}));
vi.mock("../../src/llm/prompt-registry", () => ({
  getActivePrompt: providerMocks.getActivePrompt,
}));

const createdAt = new Date("2026-09-12T12:00:00.000Z");

function candidate(
  agentName: AgentName = "intent_analyzer"
): PromptVersionCandidate {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    agent_name: agentName,
    version: 2,
    prompt_text: "Candidate system prompt",
    is_active: false,
    accuracy: null,
    promoted_at: null,
    created_at: createdAt,
  };
}

function testCase(
  agentName: AgentName = "intent_analyzer",
  expectedOutput: Record<string, unknown> = {
    summary: "Strong hiring activity",
    intent_level: "high",
  }
): AgentTestCase {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    agent_name: agentName,
    input: { context: "Five senior sales roles opened this week." },
    expected_output: expectedOutput,
    created_at: createdAt,
  };
}

function dependencies(
  overrides: Partial<PromptEvaluationDeps> = {}
): PromptEvaluationDeps {
  return {
    getPromptVersion: vi.fn(async () => candidate()),
    listAgentTestCases: vi.fn(async () => [testCase()]),
    invokeCandidate: vi.fn(async () => ({
      summary: "Different wording is allowed",
      intent_level: "high",
    })),
    compare: comparePromptResults,
    ...overrides,
  };
}

describe("runPromptEvaluation", () => {
  it("loads one exact candidate and returns auditable identity and counts", async () => {
    const deps = dependencies();

    const result = await runPromptEvaluation(
      { agentName: "intent_analyzer", version: 2 },
      deps
    );

    expect(deps.getPromptVersion).toHaveBeenCalledWith("intent_analyzer", 2);
    expect(deps.listAgentTestCases).toHaveBeenCalledWith("intent_analyzer");
    expect(result).toEqual({
      agent_name: "intent_analyzer",
      version: 2,
      prompt_version_id: "11111111-1111-4111-8111-111111111111",
      prompt_created_at: "2026-09-12T12:00:00.000Z",
      total: 1,
      passed: 1,
      failed: 0,
      accuracy: 1,
      cases: [
        { case_id: "22222222-2222-4222-8222-222222222222", passed: true },
      ],
    });
    expect(deps.invokeCandidate).toHaveBeenCalledWith({
      agentName: "intent_analyzer",
      prompt: candidate(),
      testCase: testCase(),
    });
  });

  it("passes the stored candidate prompt text byte-for-byte to the invocation adapter", async () => {
    const storedPrompt = "  Candidate prompt with intentional framing\n";
    const invokeCandidate = vi.fn(
      async (_request: Parameters<PromptEvaluationDeps["invokeCandidate"]>[0]) => ({
        summary: "Valid output",
        intent_level: "high",
      })
    );
    const deps = dependencies({
      getPromptVersion: vi.fn(async () => ({
        ...candidate(),
        prompt_text: storedPrompt,
      })),
      invokeCandidate,
    });

    await runPromptEvaluation({ agentName: "intent_analyzer", version: 2 }, deps);

    expect(invokeCandidate).toHaveBeenCalledOnce();
    expect(invokeCandidate.mock.calls[0]?.[0].prompt.prompt_text).toBe(storedPrompt);
  });

  it.each([
    [{ agentName: "chat_agent", version: 2 }, "Unsupported prompt evaluator"],
    [{ agentName: "intent_analyzer", version: 0 }, "positive safe integer"],
    [
      { agentName: "intent_analyzer", version: Number.MAX_SAFE_INTEGER + 1 },
      "positive safe integer",
    ],
  ])("rejects unsupported or invalid requests before invoking a provider", async (request, message) => {
    const deps = dependencies({
      getPromptVersion: vi.fn(async () => candidate(request.agentName as AgentName)),
      listAgentTestCases: vi.fn(async () => [testCase(request.agentName as AgentName)]),
    });

    await expect(
      runPromptEvaluation(request as PromptEvaluationRequest, deps)
    ).rejects.toThrow(message);
    expect(deps.invokeCandidate).not.toHaveBeenCalled();
  });

  it("rejects a missing candidate, candidate mismatch, and an empty case set", async () => {
    await expect(
      runPromptEvaluation(
        { agentName: "intent_analyzer", version: 2 },
        dependencies({ getPromptVersion: vi.fn(async () => undefined) })
      )
    ).rejects.toThrow("not found");

    await expect(
      runPromptEvaluation(
        { agentName: "intent_analyzer", version: 2 },
        dependencies({
          getPromptVersion: vi.fn(async () => candidate("synthesis")),
        })
      )
    ).rejects.toThrow("does not match");

    await expect(
      runPromptEvaluation(
        { agentName: "intent_analyzer", version: 2 },
        dependencies({ listAgentTestCases: vi.fn(async () => []) })
      )
    ).rejects.toThrow("no labeled test cases");
  });

  it("rejects malformed expected and candidate output instead of counting either as a failure", async () => {
    const malformedExpected = dependencies({
      listAgentTestCases: vi.fn(async () => [
        testCase("intent_analyzer", { summary: "present", intent_level: "urgent" }),
      ]),
    });
    await expect(
      runPromptEvaluation(
        { agentName: "intent_analyzer", version: 2 },
        malformedExpected
      )
    ).rejects.toThrow();

    const malformedActual = dependencies({
      invokeCandidate: vi.fn(async () => ({ summary: "", intent_level: "high" })),
    });
    await expect(
      runPromptEvaluation(
        { agentName: "intent_analyzer", version: 2 },
        malformedActual
      )
    ).rejects.toThrow();
  });

  it("validates every curated label before making the first paid invocation", async () => {
    const invokeCandidate = vi.fn(async () => ({
      summary: "Valid output",
      intent_level: "high",
    }));
    const deps = dependencies({
      listAgentTestCases: vi.fn(async () => [
        testCase(),
        {
          ...testCase(),
          id: "33333333-3333-4333-8333-333333333333",
          expected_output: { summary: "Invalid label", intent_level: "urgent" },
        },
      ]),
      invokeCandidate,
    });

    await expect(
      runPromptEvaluation({ agentName: "intent_analyzer", version: 2 }, deps)
    ).rejects.toThrow();

    expect(invokeCandidate).not.toHaveBeenCalled();
  });

  it("propagates provider and database failures without manufacturing a score", async () => {
    const providerFailure = dependencies({
      invokeCandidate: vi.fn(async () => {
        throw new Error("provider timeout");
      }),
    });
    await expect(
      runPromptEvaluation(
        { agentName: "intent_analyzer", version: 2 },
        providerFailure
      )
    ).rejects.toThrow("provider timeout");

    const databaseFailure = dependencies({
      getPromptVersion: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });
    await expect(
      runPromptEvaluation(
        { agentName: "intent_analyzer", version: 2 },
        databaseFailure
      )
    ).rejects.toThrow("database unavailable");
  });
});

describe("comparePromptResults", () => {
  it.each([
    [
      "intent_analyzer",
      { summary: "actual", intent_level: "high" },
      { summary: "expected", intent_level: "high" },
      true,
    ],
    [
      "intent_analyzer",
      { summary: "actual", intent_level: "low" },
      { summary: "expected", intent_level: "high" },
      false,
    ],
    [
      "sentiment_clusterer",
      {
        summary: "actual",
        new_complaints: [" Slow UI ", "slow ui", "PRICE"],
        chronic_complaints: ["Support"],
      },
      {
        summary: "expected",
        new_complaints: ["price", "slow ui"],
        chronic_complaints: ["support"],
      },
      true,
    ],
    [
      "sentiment_clusterer",
      { summary: "actual", new_complaints: ["support"], chronic_complaints: [] },
      { summary: "expected", new_complaints: [], chronic_complaints: ["support"] },
      false,
    ],
    [
      "change_detector",
      { summary: "actual", old_price: " $10 / Month ", new_price: "$20 / MONTH" },
      { summary: "expected", old_price: "$10 / month", new_price: "$20 / month" },
      true,
    ],
    [
      "change_detector",
      { summary: "actual", old_price: null, new_price: "$20" },
      { summary: "expected", old_price: "$10", new_price: "$20" },
      false,
    ],
    [
      "pattern_detector",
      { summary: "actual", trend: "increasing" },
      { summary: "expected", trend: "increasing" },
      true,
    ],
    [
      "pattern_detector",
      { summary: "actual", trend: "stable" },
      { summary: "expected", trend: "increasing" },
      false,
    ],
    [
      "vulnerability_detector",
      { summary: "actual", window_open: true, positioning_copy: "Lead with reliability." },
      { summary: "expected", window_open: true, positioning_copy: "Different copy." },
      true,
    ],
    [
      "vulnerability_detector",
      { summary: "actual", window_open: false, positioning_copy: "" },
      { summary: "expected", window_open: true, positioning_copy: "Act now." },
      false,
    ],
    [
      "synthesis",
      { action: "alert", reason: "actual reason" },
      { action: "alert", reason: "expected reason" },
      true,
    ],
    [
      "synthesis",
      { action: "digest", reason: "actual reason" },
      { action: "alert", reason: "expected reason" },
      false,
    ],
  ] as const)("compares only the explicit %s label contract", (agentName, actual, expected, result) => {
    expect(comparePromptResults(agentName, actual, expected)).toBe(result);
  });

  it("rejects malformed vulnerability invariants and unsupported agents", () => {
    expect(() =>
      comparePromptResults(
        "vulnerability_detector",
        { summary: "open", window_open: true, positioning_copy: "" },
        { summary: "open", window_open: true, positioning_copy: "Act now" }
      )
    ).toThrow();
    expect(() =>
      comparePromptResults(
        "chat_agent",
        { refused: true },
        { refused: true }
      )
    ).toThrow("Unsupported prompt evaluator");
  });

  it("does not use generic JSON equality or compare free-text wording", () => {
    expect(
      comparePromptResults(
        "intent_analyzer",
        { summary: "Completely different prose", intent_level: "high" },
        { summary: "Curated prose", intent_level: "high" }
      )
    ).toBe(true);
  });
});

describe("invokeDefaultCandidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerMocks.getDailySpend.mockResolvedValue(0);
    providerMocks.getDailyBudget.mockReturnValue(2);
    providerMocks.selectModel.mockImplementation(async (model: string) => model);
    providerMocks.getCompanyContext.mockResolvedValue("COMPANY CONTEXT");
    providerMocks.trackLatency.mockImplementation(
      async (_agentName: unknown, _telemetry: unknown, operation: () => Promise<unknown>) =>
        operation()
    );
  });

  it("uses the exact candidate prompt and production intent schema with bounded telemetry", async () => {
    providerMocks.openAiInvoke.mockResolvedValue({
      raw: { usage_metadata: { input_tokens: 12, output_tokens: 4 } },
      parsed: { summary: "Hiring", intent_level: "high" },
    });
    const prompt = { ...candidate(), prompt_text: "  EXACT CANDIDATE\n" };
    const currentCase = {
      ...testCase(),
      input: {
        competitor_id: "44444444-4444-4444-8444-444444444444",
        context: "Five roles opened.",
      },
    };

    await expect(
      invokeDefaultCandidate({
        agentName: "intent_analyzer",
        prompt,
        testCase: currentCase,
      })
    ).resolves.toEqual({ summary: "Hiring", intent_level: "high" });

    expect(providerMocks.openAiConstructor).toHaveBeenCalledWith({
      model: "gpt-4.1",
      timeout: 30_000,
      maxRetries: 2,
    });
    expect(providerMocks.openAiWithStructuredOutput).toHaveBeenCalledWith(
      HiringIntentSchema,
      { includeRaw: true }
    );
    expect(providerMocks.openAiInvoke).toHaveBeenCalledWith([
      ["system", "  EXACT CANDIDATE\n\n\nCOMPANY CONTEXT"],
      ["human", "Five roles opened."],
    ]);
    expect(providerMocks.trackLatency).toHaveBeenCalledWith(
      "intent_analyzer",
      {
        competitorId: "44444444-4444-4444-8444-444444444444",
        identity: {
          kind: "job",
          jobId: "prompt-eval-22222222-2222-4222-8222-222222222222",
        },
      },
      expect.any(Function)
    );
    expect(providerMocks.trackCost).toHaveBeenCalledWith(
      "intent_analyzer",
      "gpt-4.1",
      12,
      4,
      expect.any(Object)
    );
    expect(providerMocks.getActivePrompt).not.toHaveBeenCalled();
  });

  it("uses the production two-call vulnerability schemas without changing candidate text", async () => {
    providerMocks.openAiInvoke.mockResolvedValue({
      raw: { usage_metadata: { input_tokens: 5, output_tokens: 2 } },
      parsed: { window_open: true, reasoning: "A clear opening" },
    });
    providerMocks.anthropicInvoke.mockResolvedValue({
      raw: { usage_metadata: { input_tokens: 3, output_tokens: 2 } },
      parsed: { positioning_copy: "Lead with reliability" },
    });
    const prompt = candidate("vulnerability_detector");
    const currentCase = {
      ...testCase("vulnerability_detector", {
        summary: "A clear opening",
        window_open: true,
        positioning_copy: "Lead with reliability",
      }),
      input: {
        competitor_id: "44444444-4444-4444-8444-444444444444",
        context: "Pricing and outage evidence.",
      },
    };

    await expect(
      invokeDefaultCandidate({
        agentName: "vulnerability_detector",
        prompt,
        testCase: currentCase,
      })
    ).resolves.toEqual({
      summary: "A clear opening",
      window_open: true,
      positioning_copy: "Lead with reliability",
    });

    expect(providerMocks.openAiWithStructuredOutput).toHaveBeenCalledWith(
      VulnerabilityWindowSchema,
      { includeRaw: true }
    );
    expect(providerMocks.anthropicWithStructuredOutput).toHaveBeenCalledWith(
      VulnerabilityPositioningSchema,
      { includeRaw: true }
    );
    expect(providerMocks.anthropicConstructor).toHaveBeenCalledWith({
      model: "anthropic-sonnet-id",
      clientOptions: { timeout: 30_000 },
      maxRetries: 2,
    });
    expect(providerMocks.anthropicInvoke).toHaveBeenCalledWith([
      ["system", "Candidate system prompt\n\nCOMPANY CONTEXT"],
      ["human", "A clear opening"],
    ]);
    expect(providerMocks.trackCost).toHaveBeenCalledTimes(2);
  });

  it("fails before constructing a provider client when the daily budget is exhausted", async () => {
    providerMocks.getDailySpend.mockResolvedValue(2);

    await expect(
      invokeDefaultCandidate({
        agentName: "intent_analyzer",
        prompt: candidate(),
        testCase: {
          ...testCase(),
          input: {
            competitor_id: "44444444-4444-4444-8444-444444444444",
            context: "Evidence",
          },
        },
      })
    ).rejects.toThrow("budget is exhausted");
    expect(providerMocks.openAiConstructor).not.toHaveBeenCalled();
    expect(providerMocks.anthropicConstructor).not.toHaveBeenCalled();
  });
});

describe("runEvalCli", () => {
  it("validates CLI input before lazy-loading dependencies and prints safe JSON", async () => {
    const deps = dependencies();
    const cleanup = vi.fn(async () => undefined);
    const loadRuntime = vi.fn(async () => ({ deps, cleanup }));
    const stdout = vi.fn();
    const stderr = vi.fn();

    await expect(
      runEvalCli(
        ["--agent-name=intent_analyzer", "--version=2"],
        loadRuntime,
        { stdout, stderr }
      )
    ).resolves.toBe(0);

    expect(loadRuntime).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(stderr).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.mock.calls[0][0])).toEqual(
      expect.objectContaining({
        agent_name: "intent_analyzer",
        version: 2,
        total: 1,
        passed: 1,
      })
    );
  });

  it.each([
    [["--agent-name=intent_analyzer", "--version=0"]],
    [["--agent-name=intent_analyzer", "--version=1.5"]],
    [["--agent-name=intent_analyzer", "--version=9007199254740992"]],
    [["--agent-name=intent_analyzer", "--version=2", "--extra=x"]],
    [["--agent-name=intent_analyzer", "--version=2", "--version=3"]],
    [["intent_analyzer", "--version=2"]],
  ])("rejects invalid CLI arguments before loading the runtime: %j", async (argv) => {
    const loadRuntime = vi.fn();
    const stdout = vi.fn();
    const stderr = vi.fn();

    await expect(runEvalCli(argv, loadRuntime, { stdout, stderr })).resolves.toBe(1);

    expect(loadRuntime).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledOnce();
  });
});
