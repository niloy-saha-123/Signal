import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSignalByIdMock, updateSignalEntitiesMock } = vi.hoisted(() => ({
  getSignalByIdMock: vi.fn(),
  updateSignalEntitiesMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/queries", () => ({
  getSignalById: getSignalByIdMock,
  updateSignalEntities: updateSignalEntitiesMock,
}));

const { queueAddMock, registerWorkerMock } = vi.hoisted(() => ({
  queueAddMock: vi.fn().mockResolvedValue(undefined),
  registerWorkerMock: vi.fn(),
}));

vi.mock("../queues/registry", () => ({
  registerWorker: registerWorkerMock,
  queues: { "pipeline-quality-scoring": { add: queueAddMock } },
}));

const { selectModelMock, getDailyBudgetMock } = vi.hoisted(() => ({
  selectModelMock: vi.fn().mockResolvedValue("gpt-4o-mini"),
  getDailyBudgetMock: vi.fn().mockReturnValue(2.0),
}));

vi.mock("../llm/adaptive-router", () => ({
  selectModel: selectModelMock,
  getDailyBudget: getDailyBudgetMock,
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger", () => ({ logger: loggerMock }));

const { getActivePromptMock } = vi.hoisted(() => ({
  getActivePromptMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("../llm/prompt-registry", () => ({
  getActivePrompt: getActivePromptMock,
}));

const { trackCostMock, getDailySpendMock } = vi.hoisted(() => ({
  trackCostMock: vi.fn().mockResolvedValue(0),
  getDailySpendMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("../llm/cost-tracker", () => ({
  trackCost: trackCostMock,
  getDailySpend: getDailySpendMock,
}));

const { trackLatencyMock } = vi.hoisted(() => ({
  // Mirrors the real trackLatency's pass-through contract (call fn, return its
  // result) so tests exercise the actual invoke() call through the wrapper.
  trackLatencyMock: vi.fn((_agentName: string, _competitorId: string, _runId: string, fn: () => unknown) =>
    fn()
  ),
}));

vi.mock("../lib/latency-tracker", () => ({
  trackLatency: trackLatencyMock,
}));

const { invokeMock, withStructuredOutputMock, chatOpenAIMock } = vi.hoisted(() => {
  const invokeMock = vi.fn();
  const withStructuredOutputMock = vi.fn(() => ({ invoke: invokeMock }));
  // Real class as the mock implementation (same pattern as embeddings.test.ts's
  // OpenAIEmbeddingsMock) — an arrow-function mockImplementation can't be `new`'d,
  // which is exactly what entity-extractor.ts does with ChatOpenAI.
  class ChatOpenAIMockClass {
    withStructuredOutput = withStructuredOutputMock;
  }
  const chatOpenAIMock = vi.fn(ChatOpenAIMockClass);
  return { invokeMock, withStructuredOutputMock, chatOpenAIMock };
});

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: chatOpenAIMock,
}));

import { SignalEntitiesSchema } from "@signal/shared";
import { entityExtractorProcessor, initEntityExtractorWorker } from "./entity-extractor";

const signal = {
  id: "s1",
  competitor_id: "c1",
  source: "reddit" as const,
  source_url: null,
  title: null,
  raw_text: "Acme just launched Widget Pro for $99/month with SSO support.",
  quality_score: 0,
  entities: {},
  cluster_id: null,
  collected_at: new Date(),
  created_at: new Date(),
};

const parsedEntities = { prices: ["$99/month"], products: ["Widget Pro"], features: ["SSO"] };

function invokeResult(overrides: Partial<{ raw: Record<string, unknown>; parsed: unknown }> = {}) {
  return {
    raw: { usage_metadata: { input_tokens: 42, output_tokens: 7 } },
    parsed: parsedEntities,
    ...overrides,
  };
}

describe("pipeline/entity-extractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSignalByIdMock.mockResolvedValue(signal);
    selectModelMock.mockResolvedValue("gpt-4o-mini");
    getDailyBudgetMock.mockReturnValue(2.0);
    getDailySpendMock.mockResolvedValue(0);
    getActivePromptMock.mockResolvedValue(null);
    trackCostMock.mockResolvedValue(0);
    updateSignalEntitiesMock.mockResolvedValue(undefined);
    queueAddMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValue(invokeResult());
    trackLatencyMock.mockImplementation((_a: string, _c: string, _r: string, fn: () => unknown) => fn());
  });

  it("returns early without calling the LLM when the signal is not found", async () => {
    getSignalByIdMock.mockResolvedValue(undefined);

    await expect(
      entityExtractorProcessor({ id: "job1", data: { signal_id: "missing" } } as never)
    ).resolves.toBeUndefined();

    expect(chatOpenAIMock).not.toHaveBeenCalled();
    expect(updateSignalEntitiesMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("resolves the model via selectModel and instantiates ChatOpenAI with it", async () => {
    selectModelMock.mockResolvedValue("gpt-4o-mini");

    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(selectModelMock).toHaveBeenCalledWith("gpt-4o-mini", true);
    // timeout/maxRetries are explicit rather than inherited: LangChain's defaults
    // (openai-node's 10-minute timeout × AsyncCaller's maxRetries: 6) can hold one of
    // this queue's two worker slots for ~70 minutes on a hung endpoint.
    expect(chatOpenAIMock).toHaveBeenCalledWith({
      model: "gpt-4o-mini",
      timeout: 30_000,
      maxRetries: 2,
    });
  });

  it("requests structured output against SignalEntitiesSchema with includeRaw so usage_metadata is reachable", async () => {
    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(withStructuredOutputMock).toHaveBeenCalledWith(SignalEntitiesSchema, {
      includeRaw: true,
    });
  });

  it("uses the active prompt from the registry when one exists", async () => {
    getActivePromptMock.mockResolvedValue("custom prompt text");

    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(getActivePromptMock).toHaveBeenCalledWith("entity_extractor");
    expect(invokeMock).toHaveBeenCalledWith([
      ["system", "custom prompt text"],
      ["human", signal.raw_text],
    ]);
  });

  it("falls back to a hardcoded default prompt when no active prompt row exists", async () => {
    getActivePromptMock.mockResolvedValue(null);

    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    const [messages] = invokeMock.mock.calls[0];
    const [systemMessage] = messages as [string, string][];
    expect(systemMessage[0]).toBe("system");
    expect(typeof systemMessage[1]).toBe("string");
    expect((systemMessage[1] as string).length).toBeGreaterThan(0);
  });

  it("wraps the LLM invocation in trackLatency with entity_extractor/competitor_id/runId", async () => {
    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(trackLatencyMock).toHaveBeenCalledWith(
      "entity_extractor",
      "c1",
      "job1",
      expect.any(Function)
    );
  });

  it("falls back to the signal id as runId when job.id is missing", async () => {
    await entityExtractorProcessor({ id: undefined, data: { signal_id: "s1" } } as never);

    expect(trackLatencyMock).toHaveBeenCalledWith(
      "entity_extractor",
      "c1",
      "s1",
      expect.any(Function)
    );
  });

  it("writes the parsed entities to the signal via updateSignalEntities", async () => {
    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(updateSignalEntitiesMock).toHaveBeenCalledWith("s1", parsedEntities);
  });

  it("tracks cost using the real token counts from usage_metadata", async () => {
    invokeMock.mockResolvedValue(
      invokeResult({ raw: { usage_metadata: { input_tokens: 100, output_tokens: 20 } } })
    );

    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(trackCostMock).toHaveBeenCalledWith(
      "entity_extractor",
      "gpt-4o-mini",
      100,
      20,
      "job1",
      "c1"
    );
  });

  it("tracks cost with 0/0 tokens when usage_metadata is missing from the raw message", async () => {
    invokeMock.mockResolvedValue(invokeResult({ raw: {} }));

    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(trackCostMock).toHaveBeenCalledWith("entity_extractor", "gpt-4o-mini", 0, 0, "job1", "c1");
  });

  it("enqueues pipeline-quality-scoring after a successful extraction", async () => {
    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(queueAddMock).toHaveBeenCalledWith("score-quality", { signal_id: "s1" });
  });

  // withStructuredOutput({ includeRaw: true }) resolves { parsed: null } on a Zod
  // validation failure rather than throwing, while the TS type still claims
  // SignalEntities — writing that through would set entities to NULL silently.
  it("never writes a null parse to the signal, and logs it", async () => {
    invokeMock.mockResolvedValue(invokeResult({ parsed: null }));

    await expect(
      entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never)
    ).resolves.toBeUndefined();

    expect(updateSignalEntitiesMock).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("schema validation"),
      expect.objectContaining({ signal_id: "s1" })
    );
  });

  it("still advances the pipeline after a null parse", async () => {
    invokeMock.mockResolvedValue(invokeResult({ parsed: null }));

    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(queueAddMock).toHaveBeenCalledWith("score-quality", { signal_id: "s1" });
  });

  // Extraction is enrichment; quality-scoring and Pinecone indexing downstream are not.
  it("logs and still enqueues quality-scoring when the LLM call throws", async () => {
    invokeMock.mockRejectedValue(new Error("openai is down"));

    await expect(
      entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never)
    ).resolves.toBeUndefined();

    expect(updateSignalEntitiesMock).not.toHaveBeenCalled();
    expect(queueAddMock).toHaveBeenCalledWith("score-quality", { signal_id: "s1" });
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("advancing pipeline"),
      expect.objectContaining({ signal_id: "s1", error: "openai is down" })
    );
  });

  it("skips the LLM entirely once the daily budget is spent, but still enqueues quality-scoring", async () => {
    getDailyBudgetMock.mockReturnValue(2.0);
    getDailySpendMock.mockResolvedValue(2.0);

    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(chatOpenAIMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(updateSignalEntitiesMock).not.toHaveBeenCalled();
    expect(queueAddMock).toHaveBeenCalledWith("score-quality", { signal_id: "s1" });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("budget"),
      expect.objectContaining({ signal_id: "s1" })
    );
  });

  // getDailySpend fails safe to Infinity on a DB error — the budget check must then
  // skip extraction rather than fail open into unbounded spend.
  it("skips the LLM when getDailySpend fails safe to Infinity", async () => {
    getDailySpendMock.mockResolvedValue(Number.POSITIVE_INFINITY);

    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(queueAddMock).toHaveBeenCalledWith("score-quality", { signal_id: "s1" });
  });

  // A retry after the LLM call already succeeded must not re-pay for it, nor write a
  // second llm_costs / agent_latencies row for one logical extraction.
  it("does not re-invoke the LLM when entities are already populated, but still enqueues", async () => {
    getSignalByIdMock.mockResolvedValue({
      ...signal,
      entities: { prices: ["$99/month"], products: [], features: [] },
    });

    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(chatOpenAIMock).not.toHaveBeenCalled();
    expect(trackCostMock).not.toHaveBeenCalled();
    expect(updateSignalEntitiesMock).not.toHaveBeenCalled();
    expect(queueAddMock).toHaveBeenCalledWith("score-quality", { signal_id: "s1" });
  });

  it("treats an all-empty entities object as not-yet-extracted and runs the LLM", async () => {
    getSignalByIdMock.mockResolvedValue({
      ...signal,
      entities: { prices: [], products: [], features: [] },
    });

    await entityExtractorProcessor({ id: "job1", data: { signal_id: "s1" } } as never);

    expect(invokeMock).toHaveBeenCalled();
  });

  it("registers the pipeline-entity-extraction worker via initEntityExtractorWorker without registering at import time", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();

    initEntityExtractorWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith(
      "pipeline-entity-extraction",
      entityExtractorProcessor
    );
  });
});
