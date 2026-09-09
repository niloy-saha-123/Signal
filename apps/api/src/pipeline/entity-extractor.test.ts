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

const { selectModelMock } = vi.hoisted(() => ({
  selectModelMock: vi.fn().mockResolvedValue("gpt-4o-mini"),
}));

vi.mock("../llm/adaptive-router", () => ({
  selectModel: selectModelMock,
}));

const { getActivePromptMock } = vi.hoisted(() => ({
  getActivePromptMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("../llm/prompt-registry", () => ({
  getActivePrompt: getActivePromptMock,
}));

const { trackCostMock } = vi.hoisted(() => ({
  trackCostMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("../llm/cost-tracker", () => ({
  trackCost: trackCostMock,
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
    expect(chatOpenAIMock).toHaveBeenCalledWith({ model: "gpt-4o-mini" });
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

  it("registers the pipeline-entity-extraction worker via initEntityExtractorWorker without registering at import time", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();

    initEntityExtractorWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith(
      "pipeline-entity-extraction",
      entityExtractorProcessor
    );
  });
});
