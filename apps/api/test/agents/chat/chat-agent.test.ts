// Adapter tests for the thin single-turn runChatAgent over the checkpointed
// graph. The graph module is mocked (chatGraph.invoke / setupChatCheckpointer)
// so these are hermetic — no Postgres. A dummy DATABASE_URL is set before import
// so chat-graph's loadRootEnv() can't inject the real Supabase URL into the
// checkpointer it builds at module load (the pg.Pool it wraps never connects).
process.env.DATABASE_URL = "postgres://signal:signal@localhost:5433/signal";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import type { ChatAgentResult } from "@signal/shared";

const { invokeMock, setupMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  setupMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/agents/chat/chat-graph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agents/chat/chat-graph")>();
  return {
    ...actual,
    chatGraph: { invoke: invokeMock },
    setupChatCheckpointer: setupMock,
  };
});

import { runChatAgent } from "@/agents/chat/chat-agent";

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

    const config = invokeMock.mock.calls[0][1] as { configurable: Record<string, unknown> };
    const signal = config.configurable.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
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