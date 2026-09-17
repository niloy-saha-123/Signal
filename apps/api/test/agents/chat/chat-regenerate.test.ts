// Time-travel integration test: proves listCheckpointsDefault and
// regenerateDefault work against the real PostgresSaver (getStateHistory +
// updateState fork + invoke), not just that the router compiles.
process.env.DATABASE_URL = "postgres://signal:signal@localhost:5433/signal";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";

const DB_TIMEOUT = 20_000;
const dbIt = (name: string, fn: () => Promise<void>, timeout = DB_TIMEOUT) =>
  it(name, fn, timeout);

const { hybridRetrieveMock, rerankChunksMock, enforceCitationsMock } = vi.hoisted(() => ({
  hybridRetrieveMock: vi.fn(),
  rerankChunksMock: vi.fn(),
  enforceCitationsMock: vi.fn(),
}));

vi.mock("@/retrieval", () => ({
  hybridRetrieve: hybridRetrieveMock,
  rerankChunks: rerankChunksMock,
  enforceCitations: enforceCitationsMock,
  getCitationEnforcementThreshold: () => 0.75,
}));

const { getCompanyContextMock } = vi.hoisted(() => ({ getCompanyContextMock: vi.fn() }));
vi.mock("@/lib/company-context", () => ({ getCompanyContext: getCompanyContextMock }));

const { getActivePromptMock } = vi.hoisted(() => ({ getActivePromptMock: vi.fn() }));
vi.mock("@/llm/prompt-registry", () => ({ getActivePrompt: getActivePromptMock }));

const { selectModelMock } = vi.hoisted(() => ({ selectModelMock: vi.fn() }));
vi.mock("@/llm/adaptive-router", () => ({
  selectModel: selectModelMock,
  ANTHROPIC_MODEL_IDS: { "claude-sonnet": "claude-sonnet-5", "claude-haiku": "claude-haiku-4-5-20251001" },
}));

const { trackCostMock } = vi.hoisted(() => ({ trackCostMock: vi.fn() }));
vi.mock("@/llm/cost-tracker", () => ({ trackCost: trackCostMock }));

const { trackLatencyMock } = vi.hoisted(() => ({
  trackLatencyMock: vi.fn((_a: string, _c: unknown, fn: () => unknown) => fn()),
}));
vi.mock("@/lib/latency-tracker", () => ({ trackLatency: trackLatencyMock }));

const { withCircuitBreakerMock } = vi.hoisted(() => ({
  withCircuitBreakerMock: vi.fn((_s: string, fn: () => unknown) => fn()),
}));
vi.mock("@/reliability/circuit-breaker", () => ({ withCircuitBreaker: withCircuitBreakerMock }));

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
vi.mock("@langchain/anthropic", () => ({ ChatAnthropic: chatAnthropicMock }));

// chat-threads.ts imports ../db/queries (→ db/client → a real pg pool); this
// test only exercises the checkpointer-backed time-travel helpers, so stub the
// query functions it references to avoid opening a pool against the ambient
// DATABASE_URL.
vi.mock("@/db/queries", () => ({
  createChatThread: vi.fn(),
  listChatThreadsForWorkspace: vi.fn(),
  getChatThreadForWorkspace: vi.fn(),
  deleteChatThreadForWorkspace: vi.fn(),
}));

import { getChatGraph, setupChatCheckpointer, CHAT_RECURSION_LIMIT } from "@/agents/chat/chat-graph";
import { listCheckpointsDefault, regenerateDefault } from "@/api/chat-threads";

const COMPETITOR_1 = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000000";

function toolCallChunk(id: string): AIMessageChunk {
  return new AIMessageChunk({
    content: "",
    tool_call_chunks: [{ name: "retrieve_signals", args: JSON.stringify({ query: "q" }), id, index: 0 }],
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
    for (const c of chunks) yield c;
  };
}

// One turn = retrieve (tool call) then answer with the given text.
function mockTurn(answer: string) {
  streamMock
    .mockImplementationOnce(streamOf(toolCallChunk(`call-${answer}`)))
    .mockImplementationOnce(streamOf(answerChunk(answer)));
}

async function invoke(query: string, threadId: string) {
  return getChatGraph().invoke(
    {
      messages: [new HumanMessage(query)],
      workspace_id: WORKSPACE_ID,
      competitor_ids: [COMPETITOR_1],
      run_id: randomUUID(),
      summary: "",
    },
    { configurable: { thread_id: threadId }, recursionLimit: CHAT_RECURSION_LIMIT }
  );
}

describe("chat threads — time travel (fork and replay)", () => {
  beforeAll(async () => {
    await setupChatCheckpointer();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getCompanyContextMock.mockResolvedValue("");
    getActivePromptMock.mockResolvedValue(null);
    selectModelMock.mockResolvedValue("claude-sonnet");
    trackCostMock.mockResolvedValue(0);
    hybridRetrieveMock.mockResolvedValue([{ id: "signal-1" }]);
    rerankChunksMock.mockResolvedValue([
      { id: "signal-1", competitor_id: COMPETITOR_1, source: "reddit", source_url: null, text: "t", quality_score: 0.8, origin: "both", rrf_score: 0.03, relevance_score: 0.9 },
    ]);
    // Echo the model's draft as the verified answer so each turn's result is
    // distinguishable.
    enforceCitationsMock.mockImplementation(async (draft: string) => ({
      refused: false,
      answer: draft,
      citations: [{ claim: draft, chunk_id: "signal-1", source: "reddit", similarity_score: 0.9 }],
    }));
    invokeMock.mockResolvedValue({
      content: "summary",
      usage_metadata: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  dbIt("listCheckpointsDefault returns one turn-start checkpoint per turn", async () => {
    const threadId = randomUUID();
    mockTurn("answer-1");
    mockTurn("answer-2");
    mockTurn("answer-3");

    await invoke("q1", threadId);
    await invoke("q2", threadId);
    await invoke("q3", threadId);

    const checkpoints = await listCheckpointsDefault(threadId);

    // Three turns -> three regenerate points, at message counts 1, 3, 5.
    expect(checkpoints.map((c) => c.message_count)).toEqual([1, 3, 5]);
    expect(checkpoints.every((c) => c.checkpoint_id.length > 0)).toBe(true);
  });

  dbIt("regenerateDefault forks a new answer without mutating the original checkpoint", async () => {
    const threadId = randomUUID();
    mockTurn("answer-1");
    mockTurn("answer-2");
    mockTurn("answer-3");

    await invoke("q1", threadId);
    await invoke("q2", threadId);
    await invoke("q3", threadId);

    const checkpoints = await listCheckpointsDefault(threadId);
    const beforeA3 = checkpoints.find((c) => c.message_count === 5);
    expect(beforeA3).toBeDefined();

    // The model answers differently on the replay.
    mockTurn("answer-3-regenerated");

    const result = await regenerateDefault(threadId, beforeA3!.checkpoint_id);
    expect(result.refused).toBe(false);
    if (!result.refused) expect(result.answer).toBe("answer-3-regenerated");

    // The original checkpoint is still reachable — fork, not mutation.
    const original = await getChatGraph().getState({
      configurable: { thread_id: threadId, checkpoint_id: beforeA3!.checkpoint_id },
    });
    expect(original.values).toBeDefined();
    expect(Array.isArray(original.values.messages)).toBe(true);
  });
});
