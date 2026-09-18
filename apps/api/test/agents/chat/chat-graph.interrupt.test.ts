// Durability proof for the HITL gate: a mutating tool call pauses the graph via
// the REAL interrupt() (not mocked), persists to the PostgresSaver checkpoint,
// and can be resumed later from a fresh invoke — the same "close the laptop and
// come back" property discovery's confirm gate has. Verifies, doesn't rebuild.
process.env.DATABASE_URL = "postgres://signal:signal@localhost:5433/signal";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";

const DB_TIMEOUT = 20_000;
const dbIt = (name: string, fn: () => Promise<void>, timeout = DB_TIMEOUT) =>
  it(name, fn, timeout);

const { streamMock, invokeMock, chatAnthropicMock } = vi.hoisted(() => {
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

const { createCompetitorInvokeMock } = vi.hoisted(() => ({
  createCompetitorInvokeMock: vi.fn().mockResolvedValue("created Acme"),
}));

vi.mock("@langchain/anthropic", () => ({ ChatAnthropic: chatAnthropicMock }));

vi.mock("@/agents/chat/tools", () => ({
  MUTATING_TOOL_NAMES: new Set(["create_competitor"]),
  describeMutation: (name: string) => `describe ${name}`,
  buildChatTools: () => [
    { name: "create_competitor", mutating: true, tool: { invoke: createCompetitorInvokeMock } },
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

import {
  getChatGraph,
  setupChatCheckpointer,
  CHAT_RECURSION_LIMIT,
  pendingMutations,
} from "@/agents/chat/chat-graph";

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

function initialState() {
  return {
    messages: [new HumanMessage("add a competitor")],
    workspace_id: WORKSPACE_ID,
    competitor_ids: [COMPETITOR_1],
    run_id: RUN_ID,
    summary: "",
  };
}

describe("agents/chat/chat-graph — interrupt durability", () => {
  beforeAll(async () => {
    await setupChatCheckpointer();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue({ content: "PRIOR SUMMARY", usage_metadata: {} });
  });

  dbIt("persists a pending mutation across a fresh resume", async () => {
    const threadId = randomUUID();
    streamMock
      .mockImplementationOnce(streamOf(toolCallChunk("create_competitor", { name: "Acme", domain: "acme.com" }, "call-1")))
      .mockImplementationOnce(streamOf(answerChunk("Okay, I won't create it.")));

    // The first invoke runs to the confirm gate and pauses on the real interrupt.
    await getChatGraph().invoke(initialState(), {
      configurable: { thread_id: threadId },
      recursionLimit: CHAT_RECURSION_LIMIT,
    });

    // The interrupt is in the checkpoint, not tied to any open connection or timer.
    const paused = await getChatGraph().getState({ configurable: { thread_id: threadId } });
    const mutations = pendingMutations(paused);
    expect(mutations).toHaveLength(1);
    expect(mutations[0].tool_name).toBe("create_competitor");

    // Resume from a fresh invoke (simulating time/process passing) with a denial.
    const resumed = await getChatGraph().invoke(new Command({ resume: "deny" }), {
      configurable: { thread_id: threadId },
      recursionLimit: CHAT_RECURSION_LIMIT,
    });

    expect(createCompetitorInvokeMock).not.toHaveBeenCalled();
    expect(resumed.citation_result).toMatchObject({ refused: false });

    const after = await getChatGraph().getState({ configurable: { thread_id: threadId } });
    expect(pendingMutations(after)).toHaveLength(0);
  });
});