// Adapter tests for the thin single-turn runChatAgent over the checkpointed
// graph. The graph module is mocked (chatGraph.invoke / setupChatCheckpointer)
// so these are hermetic — no Postgres. A dummy DATABASE_URL is set before import
// so chat-graph's loadRootEnv() can't inject the real Supabase URL into the
// checkpointer it builds at module load (the pg.Pool it wraps never connects).
process.env.DATABASE_URL = "postgres://signal:signal@localhost:5433/signal";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import type { ChatAgentResult } from "@signal/shared";

const { invokeMock, streamMock, setupMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  streamMock: vi.fn(),
  setupMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/agents/chat/chat-graph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agents/chat/chat-graph")>();
  return {
    ...actual,
    chatGraph: { invoke: invokeMock, stream: streamMock },
    setupChatCheckpointer: setupMock,
  };
});

import { runChatAgent, streamChat } from "@/agents/chat/chat-agent";

const COMPETITOR_1 = "11111111-1111-4111-8111-111111111111";
const COMPETITOR_2 = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000000";
const ANSWER: ChatAgentResult = {
  refused: false,
  answer: "Acme support response times slowed.",
  citations: [
    {
      claim: "Acme customers report slower support response times.",
      chunk_id: "signal-1",
      source: "reddit",
      similarity_score: 0.91,
    },
  ],
};

describe("agents/chat/chat-agent — single-turn adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValue({ citation_result: ANSWER });
  });

  it("returns the graph's citation_result", async () => {
    const result = await runChatAgent({
      query: "What changed?",
      competitor_ids: [COMPETITOR_1],
      workspace_id: WORKSPACE_ID,
      run_id: RUN_ID,
    });

    expect(result).toEqual(ANSWER);
  });

  it("invokes the graph with the parsed message, a deduped scope, and an ephemeral thread_id", async () => {
    await runChatAgent(
      {
        query: "  What changed?  ",
        competitor_ids: [COMPETITOR_2, COMPETITOR_1, COMPETITOR_2],
        workspace_id: WORKSPACE_ID,
        run_id: RUN_ID,
      },
      { signal: undefined }
    );

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [state, config] = invokeMock.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(state.messages).toEqual([new HumanMessage("What changed?")]);
    expect(state.competitor_ids).toEqual([COMPETITOR_2, COMPETITOR_1]);
    expect(state.workspace_id).toBe(WORKSPACE_ID);
    expect(state.run_id).toBe(RUN_ID);
    expect(config).toMatchObject({
      configurable: { thread_id: RUN_ID },
      recursionLimit: 10,
    });
  });

  it("passes the caller signal into the graph configurable", async () => {
    const controller = new AbortController();
    await runChatAgent(
      {
        query: "What changed?",
        competitor_ids: [COMPETITOR_1],
        workspace_id: WORKSPACE_ID,
        run_id: RUN_ID,
      },
      { signal: controller.signal }
    );

    const config = invokeMock.mock.calls[0][1] as {
      configurable: Record<string, unknown>;
      signal: AbortSignal;
    };
    const signal = config.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
    expect(config.configurable.signal).toBeUndefined();
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
  ])("rejects $label before invoking the graph", async ({ query, competitors, runId }) => {
    await expect(
      runChatAgent({
        query,
        competitor_ids: competitors,
        workspace_id: WORKSPACE_ID,
        run_id: runId,
      })
    ).rejects.toThrow();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(setupMock).not.toHaveBeenCalled();
  });

  it("rejects an already-aborted request before invoking the graph", async () => {
    await expect(
      runChatAgent(
        {
          query: "What changed?",
          competitor_ids: [COMPETITOR_1],
          workspace_id: WORKSPACE_ID,
          run_id: RUN_ID,
        },
        { signal: AbortSignal.abort() }
      )
    ).rejects.toThrow();

    expect(invokeMock).not.toHaveBeenCalled();
  });
});

function asAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () =>
          i < items.length ? { value: items[i++], done: false } : { value: undefined, done: true },
      };
    },
  };
}

describe("agents/chat/chat-agent — streaming adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMock.mockResolvedValue(undefined);
  });

  it("streams generate-node tokens then the final citation_result, and omits summary from state", async () => {
    streamMock.mockResolvedValue(
      asAsyncIterable([
        [["compact:task1"], "messages", [new AIMessageChunk({ content: "internal summary " }), {}]],
        [["generate:task2"], "messages", [new AIMessageChunk({ content: "They" }), {}]],
        [["generate:task2"], "messages", [new AIMessageChunk({ content: " shipped SSO" }), {}]],
        [[], "values", { citation_result: undefined }],
        [[], "values", { citation_result: ANSWER }],
      ])
    );

    const events = [];
    for await (const evt of streamChat({
      query: "did they ship SSO?",
      competitor_ids: [COMPETITOR_1],
      workspace_id: WORKSPACE_ID,
      run_id: RUN_ID,
      thread_id: "55555555-5555-4555-8555-555555555555",
    })) {
      events.push(evt);
    }

    expect(events).toEqual([
      { kind: "token", text: "They" },
      { kind: "token", text: " shipped SSO" },
      { kind: "result", result: ANSWER },
    ]);

    const [state, config] = streamMock.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>
    ];
    expect(state.messages).toEqual([new HumanMessage("did they ship SSO?")]);
    expect(state).not.toHaveProperty("summary");
    expect(config).toMatchObject({
      configurable: { thread_id: "55555555-5555-4555-8555-555555555555" },
      streamMode: ["messages", "values"],
      recursionLimit: 10,
    });
  });

  it("yields a result with no tokens when the graph short-circuits to a refusal", async () => {
    const REFUSAL = { refused: true, reason: "none", suggested_query: "try again" };
    streamMock.mockResolvedValue(asAsyncIterable([[[], "values", { citation_result: REFUSAL }]]));

    const events = [];
    for await (const evt of streamChat({
      query: "anything?",
      competitor_ids: [COMPETITOR_1],
      workspace_id: WORKSPACE_ID,
      run_id: RUN_ID,
      thread_id: "55555555-5555-4555-8555-555555555555",
    })) {
      events.push(evt);
    }

    expect(events).toEqual([{ kind: "result", result: REFUSAL }]);
  });

  it("passes the caller signal top-level (never inside configurable)", async () => {
    streamMock.mockResolvedValue(asAsyncIterable([[[], "values", { citation_result: ANSWER }]]));
    const controller = new AbortController();

    for await (const _ of streamChat(
      {
        query: "what changed?",
        competitor_ids: [COMPETITOR_1],
        workspace_id: WORKSPACE_ID,
        run_id: RUN_ID,
        thread_id: "55555555-5555-4555-8555-555555555555",
      },
      { signal: controller.signal }
    )) {
      // drain
    }

    const [, config] = streamMock.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { configurable: Record<string, unknown>; signal: AbortSignal }
    ];
    expect(config.signal).toBeInstanceOf(AbortSignal);
    expect(config.signal.aborted).toBe(false);
    expect(config.configurable.signal).toBeUndefined();
  });
});