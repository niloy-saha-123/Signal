// Evaluates one exact candidate prompt against human-curated agent_test_cases.
import type { AgentName } from "@signal/shared";
import { AgentNameSchema } from "@signal/shared";
import { z } from "zod";
import {
  AgentTestCaseSchema,
  HiringIntentResultSchema,
  PatternsResultSchema,
  PricingChangeResultSchema,
  PromptEvaluationRequestSchema,
  PromptVersionCandidateSchema,
  SentimentClustersResultSchema,
  SynthesisDecisionSchema,
  VulnerabilityPositioningSchema,
  VulnerabilityResultSchema,
  VulnerabilityWindowSchema,
  assertSupportedPromptEvaluationAgent,
  comparePromptResults,
  parsePromptEvaluationOutput,
  type AgentTestCase,
  type PromptEvaluationRequest,
  type PromptVersionCandidate,
  type SupportedPromptEvaluationAgent,
} from "../src/evaluation/prompt-contracts";
import {
  CliUsageError,
  parseCliArgs,
  runCli,
  safeIntegerCliOption,
} from "./lib/cli";

export {
  comparePromptResults,
  type AgentTestCase,
  type PromptEvaluationRequest,
  type PromptVersionCandidate,
};

export type PromptCaseInvocation = {
  agentName: AgentName;
  prompt: PromptVersionCandidate;
  testCase: AgentTestCase;
};

export type PromptEvaluationDeps = {
  getPromptVersion: (
    agentName: AgentName,
    version: number
  ) => Promise<PromptVersionCandidate | undefined>;
  listAgentTestCases: (agentName: AgentName) => Promise<AgentTestCase[]>;
  invokeCandidate: (request: PromptCaseInvocation) => Promise<unknown>;
  compare: (agentName: AgentName, actual: unknown, expected: unknown) => boolean;
};

export type PromptEvaluationResult = {
  agent_name: AgentName;
  version: number;
  prompt_version_id: string;
  prompt_created_at: string;
  total: number;
  passed: number;
  failed: number;
  accuracy: number;
  cases: Array<{ case_id: string; passed: boolean }>;
};

export type PromptEvaluationRuntime = {
  deps: PromptEvaluationDeps;
  cleanup: () => Promise<void>;
};

export type EvalCliIo = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

const EvalOptionsSchema = z
  .object({
    "agent-name": AgentNameSchema,
    version: safeIntegerCliOption(1),
  })
  .strict();

const EvaluationInputSchema = z
  .object({
    competitor_id: z.string().uuid(),
    context: z.string().trim().min(1).max(24_000),
  })
  .strict();

const StructuredResponseSchema = z.object({ raw: z.unknown(), parsed: z.unknown() });
const UsageMetadataSchema = z
  .object({
    usage_metadata: z
      .object({
        input_tokens: z.number().int().safe().nonnegative().optional(),
        output_tokens: z.number().int().safe().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function validateRequest(request: PromptEvaluationRequest): PromptEvaluationRequest {
  const agentName = AgentNameSchema.safeParse(request.agentName);
  if (!agentName.success) throw new CliUsageError("Unknown agent name");
  if (
    !Number.isFinite(request.version) ||
    !Number.isSafeInteger(request.version) ||
    request.version <= 0
  ) {
    throw new CliUsageError("Prompt version must be a positive safe integer");
  }
  const parsed = PromptEvaluationRequestSchema.parse(request);
  assertSupportedPromptEvaluationAgent(parsed.agentName);
  return parsed;
}

export async function runPromptEvaluation(
  request: PromptEvaluationRequest,
  deps: PromptEvaluationDeps
): Promise<PromptEvaluationResult> {
  const parsedRequest = validateRequest(request);
  const prompt = await deps.getPromptVersion(parsedRequest.agentName, parsedRequest.version);
  if (!prompt) {
    throw new Error(
      `Prompt candidate ${parsedRequest.agentName} version ${parsedRequest.version} not found`
    );
  }
  const parsedPrompt = PromptVersionCandidateSchema.parse(prompt);
  if (
    parsedPrompt.agent_name !== parsedRequest.agentName ||
    parsedPrompt.version !== parsedRequest.version
  ) {
    throw new Error("Loaded prompt candidate does not match the requested agent and version");
  }

  const rawCases = await deps.listAgentTestCases(parsedRequest.agentName);
  if (rawCases.length === 0) {
    throw new Error(`Agent ${parsedRequest.agentName} has no labeled test cases`);
  }
  const cases = rawCases.map((value) => AgentTestCaseSchema.parse(value));
  if (cases.some((value) => value.agent_name !== parsedRequest.agentName)) {
    throw new Error("Loaded test case does not match the requested agent");
  }
  // Validate the complete human-curated label set before the first provider
  // call. A malformed later case must not turn a structurally invalid run into
  // a partially billed evaluation.
  const validatedCases = cases.map((testCase) => ({
    testCase,
    expected: parsePromptEvaluationOutput(
      parsedRequest.agentName,
      testCase.expected_output
    ),
  }));

  const caseResults: Array<{ case_id: string; passed: boolean }> = [];
  for (const { testCase: currentCase, expected } of validatedCases) {
    const invoked = await deps.invokeCandidate({
      agentName: parsedRequest.agentName,
      prompt: parsedPrompt,
      testCase: currentCase,
    });
    const actual = parsePromptEvaluationOutput(parsedRequest.agentName, invoked);
    caseResults.push({
      case_id: currentCase.id,
      passed: deps.compare(parsedRequest.agentName, actual, expected),
    });
  }

  const passed = caseResults.filter((result) => result.passed).length;
  return {
    agent_name: parsedRequest.agentName,
    version: parsedRequest.version,
    prompt_version_id: parsedPrompt.id,
    prompt_created_at: parsedPrompt.created_at.toISOString(),
    total: caseResults.length,
    passed,
    failed: caseResults.length - passed,
    accuracy: passed / caseResults.length,
    cases: caseResults,
  };
}

function usageTokens(raw: unknown): { input: number; output: number } {
  const parsed = UsageMetadataSchema.safeParse(raw);
  if (!parsed.success) {
    return { input: 0, output: 0 };
  }
  return {
    input: parsed.data.usage_metadata?.input_tokens ?? 0,
    output: parsed.data.usage_metadata?.output_tokens ?? 0,
  };
}

export async function invokeDefaultCandidate(
  request: PromptCaseInvocation
): Promise<unknown> {
  const input = EvaluationInputSchema.parse(request.testCase.input);
  const [
    { ChatOpenAI },
    { ChatAnthropic },
    { trackLatency },
    { trackCost, getDailySpend },
    { selectModel, getDailyBudget, ANTHROPIC_MODEL_IDS },
    { getCompanyContext },
    { getCompetitorById },
  ] = await Promise.all([
    import("@langchain/openai"),
    import("@langchain/anthropic"),
    import("../src/lib/latency-tracker.js"),
    import("../src/llm/cost-tracker.js"),
    import("../src/llm/adaptive-router.js"),
    import("../src/lib/company-context.js"),
    import("../src/db/queries.js"),
  ]);

  if ((await getDailySpend()) >= getDailyBudget()) {
    throw new Error("Daily LLM budget is exhausted; prompt evaluation was not run");
  }

  const competitor = await getCompetitorById(input.competitor_id);
  if (!competitor) {
    throw new Error(`eval: competitor ${input.competitor_id} not found`);
  }
  const companyContext = await getCompanyContext(competitor.workspace_id);
  const systemPrompt = companyContext
    ? `${request.prompt.prompt_text}\n\n${companyContext}`
    : request.prompt.prompt_text;
  const telemetry = {
    competitorId: input.competitor_id,
    identity: { kind: "job" as const, jobId: `prompt-eval-${request.testCase.id}` },
  };

  const invokeOpenAi = async (
    model: string,
    schema: z.ZodTypeAny,
    humanMessage = input.context
  ): Promise<unknown> => {
    const selectedModel = await selectModel(model, true);
    const structured = new ChatOpenAI({
      model: selectedModel,
      timeout: 30_000,
      maxRetries: 2,
    }).withStructuredOutput(schema, { includeRaw: true });
    const response = StructuredResponseSchema.parse(
      await trackLatency(request.agentName, telemetry, () =>
        structured.invoke([
          ["system", systemPrompt],
          ["human", humanMessage],
        ])
      )
    );
    const usage = usageTokens(response.raw);
    await trackCost(
      request.agentName,
      selectedModel,
      usage.input,
      usage.output,
      telemetry
    );
    if (response.parsed == null) throw new Error("Candidate returned invalid structured output");
    return response.parsed;
  };

  const invokeAnthropic = async (
    modelAlias: string,
    schema: z.ZodTypeAny,
    humanMessage = input.context
  ): Promise<unknown> => {
    const selectedAlias = await selectModel(modelAlias, true);
    const structured = new ChatAnthropic({
      model: ANTHROPIC_MODEL_IDS[selectedAlias] ?? selectedAlias,
      clientOptions: { timeout: 30_000 },
      maxRetries: 2,
    }).withStructuredOutput(schema, { includeRaw: true });
    const response = StructuredResponseSchema.parse(
      await trackLatency(request.agentName, telemetry, () =>
        structured.invoke([
          ["system", systemPrompt],
          ["human", humanMessage],
        ])
      )
    );
    const usage = usageTokens(response.raw);
    await trackCost(
      request.agentName,
      selectedAlias,
      usage.input,
      usage.output,
      telemetry
    );
    if (response.parsed == null) throw new Error("Candidate returned invalid structured output");
    return response.parsed;
  };

  switch (request.agentName as SupportedPromptEvaluationAgent) {
    case "intent_analyzer":
      return invokeOpenAi("gpt-4.1", HiringIntentResultSchema);
    case "sentiment_clusterer":
      return invokeAnthropic("claude-haiku", SentimentClustersResultSchema);
    case "change_detector":
      return invokeOpenAi("gpt-4o-mini", PricingChangeResultSchema);
    case "pattern_detector":
      return invokeOpenAi("gpt-4.1", PatternsResultSchema);
    case "synthesis":
      return invokeAnthropic("claude-sonnet", SynthesisDecisionSchema);
    case "vulnerability_detector": {
      const window = VulnerabilityWindowSchema.parse(
        await invokeOpenAi("gpt-4.1", VulnerabilityWindowSchema)
      );
      if (!window.window_open) {
        return VulnerabilityResultSchema.parse({
          summary: window.reasoning,
          window_open: false,
          positioning_copy: "",
        });
      }
      const positioning = VulnerabilityPositioningSchema.parse(
        await invokeAnthropic(
          "claude-sonnet",
          VulnerabilityPositioningSchema,
          window.reasoning
        )
      );
      return VulnerabilityResultSchema.parse({
        summary: window.reasoning,
        window_open: true,
        positioning_copy: positioning.positioning_copy,
      });
    }
  }
}

async function loadDefaultRuntime(): Promise<PromptEvaluationRuntime> {
  const [{ getPromptVersion, listAgentTestCases }, { closeDatabase }, { closeRedisConnections }] =
    await Promise.all([
      import("../src/db/queries.js"),
      import("../src/db/client.js"),
      import("../src/lib/redis-client.js"),
    ]);
  return {
    deps: {
      getPromptVersion,
      listAgentTestCases,
      invokeCandidate: invokeDefaultCandidate,
      compare: comparePromptResults,
    },
    cleanup: async () => {
      const results = await Promise.allSettled([closeRedisConnections(), closeDatabase()]);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      if (errors.length > 0) throw new AggregateError(errors, "Evaluation cleanup failed");
    },
  };
}

const defaultIo: EvalCliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

export async function runEvalCli(
  argv: string[],
  loadRuntime: () => Promise<PromptEvaluationRuntime> = loadDefaultRuntime,
  io: EvalCliIo = defaultIo
): Promise<number> {
  let cleanup: () => Promise<void> = async () => {};
  return runCli(
    async () => {
      const options = parseCliArgs(argv, EvalOptionsSchema);
      assertSupportedPromptEvaluationAgent(options["agent-name"]);
      const runtime = await loadRuntime();
      cleanup = runtime.cleanup;
      const result = await runPromptEvaluation(
        { agentName: options["agent-name"], version: options.version },
        runtime.deps
      );
      io.stdout(JSON.stringify(result, null, 2));
    },
    () => cleanup(),
    { stderr: io.stderr }
  );
}

if (require.main === module) {
  void runEvalCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
