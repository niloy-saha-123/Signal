// HITL mutation-gate tests for the checkpointed chat graph. Mirrors
// chat-graph.test.ts's hermetic model/retrieval mocks, plus a mocked interrupt
// and tool registry, so the gate routing (approve/deny) is exercised without a
// live LLM. Only the checkpoint is real (local docker-compose Postgres).
process.env.DATABASE_URL = "postgres://signal:signal@localhost:5433/signal";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";

const DB_TIMEOUT = 20_000;
const dbIt = (name: string, fn: () => Promise<void>, timeout = DB_TIMEOUT) =>
  it(name, fn, timeout);

const {
  streamMock,
  invokeMock,
  chatAnthropicMock,
} = vi.hoisted(() => {
  const streamMock = vi.fn();
  const invokeMock = vi.fn();
  class ChatAnthropicMockClass {
    stream = streamMock;
    invoke = invokeMock;
    bindTools() {
      return { stream: streamMock, invoke: invokeMock };
    }
  }
  return { streamMock, invokeMock, chatAnthropicMock: vi.fn(ChatAnthropicMockClass) };
});

const { interruptMock } = vi.hoisted(() => ({ interruptMock: vi.fn() }));

const {
  createCompetitorInvokeMock,
  listCompetitorsInvokeMock,
  describeMutationMock,
} = vi.hoisted(() => ({
  createCompetitorInvokeMock: vi.fn().mockResolvedValue("created competitor Acme"),
  listCompetitorsInvokeMock: vi.fn().mockResolvedValue("[]"),
  describeMutationMock: vi.fn((name: string) => `describe ${name}`),
}));

vi.mock("@langchain/anthropic", () => ({ ChatAnthropic: chatAnthropicMock }));

vi.mock("@langchain/langgraph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langchain/langgraph")>();
  return { ...actual, interrupt: interruptMock };
});

vi.mock("@/agents/chat/tools", () => ({
  MUTATING_TOOL_NAMES: new Set(["create_competitor"]),
  describeMutation: describeMutationMock,
  buildChatTools: () => [
    { name: "create_competitor", mutating: true, tool: { invoke: createCompetitorInvokeMock } },
    { name: "list_competitors", mutating: false, tool: { invoke: listCompetitorsInvokeMock } },
  ],
}));

vi.mock("@/retrieval", () => ({
  hybridRetrieve: vi.fn().mockResolvedValue([]),
  rerankChunks: vi.fn().mockResolvedValue([]),
  enforceCitations: vi.fn().mockResolvedValue({
    refused: false,
    answer: "okay",
    citations: [{ claim: "okay", chunk_id: "signal-1", source: "reddit", similarity_score: 0.9 }],
  }),
  getCitationEnforcementThreshold: () => 0.75,
}));

vi.mock("@/lib/company-context", () => ({ getCompanyContext: vi.fn().mockResolvedValue("") }));
vi.mock("@/llm/prompt-registry", () => ({ getActivePrompt: vi.fn().mockResolvedValue(null) }));
vi.mock("@/llm/adaptive-router", () => ({
  selectModel: vi.fn().mockResolvedValue("claude-sonnet"),
  ANTHROPIC_MODEL_IDS: { "claude-sonnet": "claude-sonnet-5", "claude-haiku": "haiku" },
}));
vi.mock("@/llm/cost-tracker", () => ({ trackCost: vi.fn().mockResolvedValue(0) }));
vi.mock("@/lib/latency-tracker", () => ({
  trackLatency: vi.fn((_a: string, _c: unknown, fn: () => unknown) => fn()),
}));
vi.mock("@/reliability/circuit-breaker", () => ({
  withCircuitBreaker: vi.fn((_s: string, fn: () => unknown) => fn()),
}));

import { getChatGraph, setupChatCheckpointer, CHAT_RECURSION_LIMIT } from "@/agents/chat/chat-graph";

const COMPETITOR_1 = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000000";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function toolCallChunk(name: string, args: Record<string, unknown>, id: string): AIMessageChunk {
  return new AIMessageChunk({
    content: "",
    tool_call_chunks: [{ name, args: JSON.stringify(args), id, index: 0 }],
    usage_metadata: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
  });
}

function answerChunk(content: string): AIMessageChunk {
  return new AIMessageChunk({
    content,
    usage_metadata: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
  });
}

function streamOf(...chunks: AIMessageChunk[]) {
  return async function* () {
    for (const chunk of chunks) yield chunk;
  };
}

function invoke() {
  return getChatGraph().invoke(
    {
      messages: [new HumanMessage("add a competitor")],
      workspace_id: WORKSPACE_ID,
      competitor_ids: [COMPETITOR_1],
      run_id: RUN_ID,
      summary: "",
    },
    { configurable: { thread_id: randomUUID() }, recursionLimit: CHAT_RECURSION_LIMIT }
  );
}

describe("agents/chat/chat-graph — HITL mutation gate", () => {
  beforeAll(async () => {
    await setupChatCheckpointer();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    interruptMock.mockReturnValue("approve");
    invokeMock.mockResolvedValue({ content: "PRIOR SUMMARY", usage_metadata: {} });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  dbIt("gates a mutating tool call through interrupt() before executing it", async () => {
    streamMock
      .mockImplementationOnce(streamOf(toolCallChunk("create_competitor", { name: "Acme", domain: "acme.com" }, "call-1")))
      .mockImplementationOnce(streamOf(answerChunk("Created.")));

    await invoke();

    expect(interruptMock).toHaveBeenCalledTimes(1);
    expect(interruptMock).toHaveBeenCalledWith({
      tool_name: "create_competitor",
      description: "describe create_competitor",
      arguments: { name: "Acme", domain: "acme.com" },
    });
    expect(createCompetitorInvokeMock).toHaveBeenCalledWith({ name: "Acme", domain: "acme.com" });
  });

  dbIt("deny skips execution and feeds the model a decline message", async () => {
    interruptMock.mockReturnValue("deny");
    streamMock
      .mockImplementationOnce(streamOf(toolCallChunk("create_competitor", { name: "Acme", domain: "acme.com" }, "call-1")))
      .mockImplementationOnce(streamOf(answerChunk("Got it, I will not create that.")));

    await invoke();

    expect(createCompetitorInvokeMock).not.toHaveBeenCalled();
    // The model's second call (after the deny routes back to generate) sees the
    // decline tool result, so it can respond rather than stall.
    const secondCall = streamMock.mock.calls[1][0] as unknown[];
    const toolMessage = secondCall[3] as { content: string };
    expect(toolMessage.content).toContain("declined");
  });

  dbIt("does not interrupt for a read-only tool call", async () => {
    streamMock
      .mockImplementationOnce(streamOf(toolCallChunk("list_competitors", {}, "call-1")))
      .mockImplementationOnce(streamOf(answerChunk("You track Acme.")));

    await invoke();

    expect(interruptMock).not.toHaveBeenCalled();
    expect(listCompetitorsInvokeMock).toHaveBeenCalledWith({});
  });
});