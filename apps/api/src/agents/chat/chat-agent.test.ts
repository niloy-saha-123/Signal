import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk, RerankedChunk } from "../../retrieval";

const { hybridRetrieveMock, rerankChunksMock, enforceCitationsMock } = vi.hoisted(() => ({
  hybridRetrieveMock: vi.fn(),
  rerankChunksMock: vi.fn(),
  enforceCitationsMock: vi.fn(),
}));

vi.mock("../../retrieval", () => ({
  hybridRetrieve: hybridRetrieveMock,
  rerankChunks: rerankChunksMock,
  enforceCitations: enforceCitationsMock,
}));

const { trackLatencyMock } = vi.hoisted(() => ({
  trackLatencyMock: vi.fn(
    (_agent: string, _competitorId: string, _runId: string, fn: () => unknown) => fn()
  ),
}));

vi.mock("../../lib/latency-tracker", () => ({ trackLatency: trackLatencyMock }));

const { cacheGetMock, cacheSetexMock } = vi.hoisted(() => ({
  cacheGetMock: vi.fn(),
  cacheSetexMock: vi.fn(),
}));

vi.mock("../../lib/redis-client", () => ({
  cacheRedis: { get: cacheGetMock, setex: cacheSetexMock },
}));

const { getCompanyContextMock } = vi.hoisted(() => ({
  getCompanyContextMock: vi.fn(),
}));

vi.mock("../../lib/company-context", () => ({ getCompanyContext: getCompanyContextMock }));

const { getActivePromptMock } = vi.hoisted(() => ({ getActivePromptMock: vi.fn() }));
vi.mock("../../llm/prompt-registry", () => ({ getActivePrompt: getActivePromptMock }));

const { selectModelMock } = vi.hoisted(() => ({ selectModelMock: vi.fn() }));
vi.mock("../../llm/adaptive-router", () => ({
  selectModel: selectModelMock,
  ANTHROPIC_MODEL_IDS: {
    "claude-sonnet": "claude-sonnet-5",
    "claude-haiku": "claude-haiku-4-5-20251001",
  },
}));

const { trackCostMock } = vi.hoisted(() => ({ trackCostMock: vi.fn() }));
vi.mock("../../llm/cost-tracker", () => ({ trackCost: trackCostMock }));

const { anthropicInvokeMock, chatAnthropicMock } = vi.hoisted(() => {
  const anthropicInvokeMock = vi.fn();
  class ChatAnthropicMockClass {
    invoke = anthropicInvokeMock;
  }
  return { anthropicInvokeMock, chatAnthropicMock: vi.fn(ChatAnthropicMockClass) };
});

vi.mock("@langchain/anthropic", () => ({ ChatAnthropic: chatAnthropicMock }));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../lib/logger", () => ({ logger: loggerMock }));

import { runChatAgent } from "./chat-agent";

const COMPETITOR_1 = "11111111-1111-4111-8111-111111111111";
const COMPETITOR_2 = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function retrieved(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: "signal-1",
    competitor_id: COMPETITOR_1,
    source: "reddit",
    source_url: "https://reddit.com/r/saas/1",
    text: "Acme customers report slower support response times.",
    quality_score: 0.8,
    origin: "both",
    rrf_score: 0.03,
    ...overrides,
  };
}

function reranked(overrides: Partial<RerankedChunk> = {}): RerankedChunk {
  return { ...retrieved(), relevance_score: 0.91, ...overrides };
}

function input() {
  return { query: "What changed?", competitor_ids: [COMPETITOR_1], run_id: RUN_ID };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agents/chat/chat-agent — input and retrieval boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheGetMock.mockResolvedValue(null);
    cacheSetexMock.mockResolvedValue("OK");
    getCompanyContextMock.mockResolvedValue("");
    getActivePromptMock.mockResolvedValue(null);
    selectModelMock.mockResolvedValue("claude-sonnet");
    trackCostMock.mockResolvedValue(0);
    hybridRetrieveMock.mockResolvedValue([retrieved()]);
    rerankChunksMock.mockResolvedValue([]);
    enforceCitationsMock.mockResolvedValue({ refused: false, answer: "answer", citations: [] });
    anthropicInvokeMock.mockResolvedValue({
      content: "answer",
      usage_metadata: { input_tokens: 20, output_tokens: 5 },
    });
    trackLatencyMock.mockImplementation(
      (_agent: string, _competitorId: string, _runId: string, fn: () => unknown) => fn()
    );
  });

  it("trims the query, de-duplicates competitor IDs, and preserves first occurrence", async () => {
    await runChatAgent({
      query: "  What changed?  ",
      competitor_ids: [COMPETITOR_2, COMPETITOR_1, COMPETITOR_2],
      run_id: RUN_ID,
    });

    expect(hybridRetrieveMock).toHaveBeenCalledWith("What changed?", [
      COMPETITOR_2,
      COMPETITOR_1,
    ]);
    expect(trackLatencyMock).toHaveBeenCalledWith(
      "chat_agent",
      COMPETITOR_2,
      RUN_ID,
      expect.any(Function)
    );
  });

  it("calls hybrid retrieval before reranking", async () => {
    await runChatAgent({
      query: "What changed?",
      competitor_ids: [COMPETITOR_1],
      run_id: RUN_ID,
    });

    expect(rerankChunksMock).toHaveBeenCalledWith("What changed?", [retrieved()]);
    expect(hybridRetrieveMock.mock.invocationCallOrder[0]).toBeLessThan(
      rerankChunksMock.mock.invocationCallOrder[0]
    );
  });

  it("returns a typed refusal without generation when hybrid retrieval has no evidence", async () => {
    hybridRetrieveMock.mockResolvedValueOnce([]);

    const result = await runChatAgent({
      query: "What changed?",
      competitor_ids: [COMPETITOR_1],
      run_id: RUN_ID,
    });

    expect(result).toMatchObject({ refused: true, suggested_query: expect.any(String) });
    expect(rerankChunksMock).not.toHaveBeenCalled();
    expect(chatAnthropicMock).not.toHaveBeenCalled();
    expect(enforceCitationsMock).not.toHaveBeenCalled();
  });

  it("returns a typed refusal without generation when reranking removes every candidate", async () => {
    const result = await runChatAgent({
      query: "What changed?",
      competitor_ids: [COMPETITOR_1],
      run_id: RUN_ID,
    });

    expect(result).toMatchObject({ refused: true, suggested_query: expect.any(String) });
    expect(chatAnthropicMock).not.toHaveBeenCalled();
    expect(enforceCitationsMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: "blank query", query: "   ", competitors: [COMPETITOR_1], runId: RUN_ID },
    { label: "oversized query", query: "x".repeat(2001), competitors: [COMPETITOR_1], runId: RUN_ID },
    { label: "empty scope", query: "question", competitors: [], runId: RUN_ID },
    {
      label: "oversized scope",
      query: "question",
      competitors: Array.from({ length: 26 }, (_, i) =>
        `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`
      ),
      runId: RUN_ID,
    },
    { label: "invalid competitor UUID", query: "question", competitors: ["not-a-uuid"], runId: RUN_ID },
    { label: "invalid run UUID", query: "question", competitors: [COMPETITOR_1], runId: "bad-run" },
  ])("rejects $label before latency or retrieval", async ({ query, competitors, runId }) => {
    await expect(
      runChatAgent({ query, competitor_ids: competitors, run_id: runId })
    ).rejects.toThrow();

    expect(trackLatencyMock).not.toHaveBeenCalled();
    expect(hybridRetrieveMock).not.toHaveBeenCalled();
  });

  it("lets trackLatency observe a failed retrieval as a failed request", async () => {
    hybridRetrieveMock.mockRejectedValueOnce(new Error("retrieval unavailable"));

    await expect(
      runChatAgent({ query: "question", competitor_ids: [COMPETITOR_1], run_id: RUN_ID })
    ).rejects.toThrow("retrieval unavailable");

    expect(trackLatencyMock).toHaveBeenCalledTimes(1);
  });

  it("passes reranked evidence forward once usable evidence exists", async () => {
    rerankChunksMock.mockResolvedValueOnce([reranked()]);

    await runChatAgent({
      query: "What changed?",
      competitor_ids: [COMPETITOR_1],
      run_id: RUN_ID,
    });

    expect(rerankChunksMock).toHaveBeenCalledWith("What changed?", [retrieved()]);
  });
});

describe("agents/chat/chat-agent — grounded generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheGetMock.mockResolvedValue(null);
    cacheSetexMock.mockResolvedValue("OK");
    getCompanyContextMock.mockResolvedValue("");
    getActivePromptMock.mockResolvedValue(null);
    selectModelMock.mockResolvedValue("claude-sonnet");
    trackCostMock.mockResolvedValue(0);
    hybridRetrieveMock.mockResolvedValue([retrieved()]);
    rerankChunksMock.mockResolvedValue([reranked()]);
    enforceCitationsMock.mockResolvedValue({
      refused: false,
      answer: "Acme support response times slowed.",
      citations: [],
    });
    anthropicInvokeMock.mockResolvedValue({
      content: "Acme support response times slowed.",
      usage_metadata: { input_tokens: 20, output_tokens: 5 },
    });
    trackLatencyMock.mockImplementation(
      (_agent: string, _competitorId: string, _runId: string, fn: () => unknown) => fn()
    );
  });

  it("uses the active prompt, company context, and an explicit untrusted-evidence boundary", async () => {
    getActivePromptMock.mockResolvedValueOnce("CUSTOM CHAT PROMPT");
    getCompanyContextMock.mockResolvedValueOnce("ABOUT THE USER'S COMPANY: Widgets Inc.");

    await runChatAgent(input());

    expect(getActivePromptMock).toHaveBeenCalledWith("chat_agent");
    expect(getCompanyContextMock).toHaveBeenCalledTimes(1);
    const messages = anthropicInvokeMock.mock.calls[0][0] as Array<[string, string]>;
    expect(messages[0][1]).toContain("CUSTOM CHAT PROMPT");
    expect(messages[0][1]).toContain("ABOUT THE USER'S COMPANY: Widgets Inc.");
    expect(messages[0][1]).toContain("untrusted source material");
    expect(messages[1][1]).toContain("EVIDENCE_START");
    expect(messages[1][1]).toContain("[signal:signal-1]");
    expect(messages[1][1]).toContain("source: reddit");
    expect(messages[1][1]).toContain("https://reddit.com/r/saas/1");
    expect(messages[1][1]).toContain("EVIDENCE_END");
  });

  it("translates the selected Anthropic alias and configures bounded generation", async () => {
    selectModelMock.mockResolvedValueOnce("claude-haiku");
    vi.stubEnv("MAX_TOKENS_PER_CALL", "999999");

    await runChatAgent(input());

    expect(selectModelMock).toHaveBeenCalledWith("claude-sonnet", true);
    expect(chatAnthropicMock).toHaveBeenCalledWith({
      model: "claude-haiku-4-5-20251001",
      clientOptions: { timeout: 30_000 },
      maxRetries: 2,
      maxTokens: 4_096,
    });
    expect(trackCostMock).toHaveBeenCalledWith(
      "chat_agent",
      "claude-haiku",
      20,
      5,
      RUN_ID,
      COMPETITOR_1
    );
  });

  it("passes the draft, exact reranked evidence, and normalized query to citation enforcement", async () => {
    const evidence = [reranked({ id: "signal-a" }), reranked({ id: "signal-b" })];
    rerankChunksMock.mockResolvedValueOnce(evidence);

    const result = await runChatAgent({ ...input(), query: "  What changed?  " });

    expect(enforceCitationsMock).toHaveBeenCalledWith(
      "Acme support response times slowed.",
      evidence,
      "What changed?"
    );
    expect(result).toEqual({
      refused: false,
      answer: "Acme support response times slowed.",
      citations: [],
    });
  });

  it("passes a citation-enforcement refusal through as a normal result", async () => {
    const refusal = {
      refused: true,
      reason: "Most claims were unsupported.",
      suggested_query: "Ask about Acme pricing in the last month.",
    } as const;
    enforceCitationsMock.mockResolvedValueOnce(refusal);

    await expect(runChatAgent(input())).resolves.toEqual(refusal);
  });

  it("extracts text blocks from Anthropic content and ignores non-text blocks", async () => {
    anthropicInvokeMock.mockResolvedValueOnce({
      content: [
        { type: "text", text: "First grounded paragraph." },
        { type: "tool_use", id: "ignored", name: "ignored", input: {} },
        { type: "text", text: "Second grounded paragraph." },
      ],
      usage_metadata: { input_tokens: 10, output_tokens: 8 },
    });

    await runChatAgent(input());

    expect(enforceCitationsMock).toHaveBeenCalledWith(
      "First grounded paragraph.\nSecond grounded paragraph.",
      [reranked()],
      "What changed?"
    );
  });

  it("tracks the billed call then throws when Anthropic returns no text", async () => {
    anthropicInvokeMock.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "only-tool", name: "ignored", input: {} }],
      usage_metadata: { input_tokens: 10, output_tokens: 1 },
    });

    await expect(runChatAgent(input())).rejects.toThrow("Claude returned no text content");

    expect(trackCostMock).toHaveBeenCalledWith(
      "chat_agent",
      "claude-sonnet",
      10,
      1,
      RUN_ID,
      COMPETITOR_1
    );
    expect(enforceCitationsMock).not.toHaveBeenCalled();
  });

  it("bounds each evidence chunk before placing it in the prompt", async () => {
    const oversized = "x".repeat(5_000);
    rerankChunksMock.mockResolvedValueOnce([reranked({ text: oversized })]);

    await runChatAgent(input());

    const messages = anthropicInvokeMock.mock.calls[0][0] as Array<[string, string]>;
    expect(messages[1][1]).toContain("x".repeat(4_000));
    expect(messages[1][1]).not.toContain("x".repeat(4_001));
  });
});
