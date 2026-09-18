// Discovery graph tests. The loop round-trip hits the local docker-compose
// Postgres (localhost:5433) for checkpoints — never the Supabase project. The
// graph compiles eagerly at import (unlike the lazy chat graph), so the URL
// must be set inside vi.hoisted — which runs before the imports that trigger
// the eager compile — rather than as a top-level statement, which ES module
// import-hoisting would evaluate only after discovery-graph has already
// captured the ambient DATABASE_URL. The model and both tools are mocked, so
// the ReAct loop is hermetic; only the checkpoint write/read is real.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://signal:signal@localhost:5433/signal";
});

const DB_TIMEOUT = 20_000;
const dbIt = (name: string, fn: () => Promise<void>, timeout = DB_TIMEOUT) =>
  it(name, fn, timeout);

const { interruptMock, createTrackedEntityCandidateMock } = vi.hoisted(() => ({
  interruptMock: vi.fn(),
  createTrackedEntityCandidateMock: vi.fn(),
}));

vi.mock("@langchain/langgraph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langchain/langgraph")>();
  return { ...actual, interrupt: interruptMock };
});

vi.mock("@/db/queries", () => ({
  createTrackedEntityCandidate: createTrackedEntityCandidateMock,
}));

const { recordDismissedCandidateMock, listDismissedDomainsMock } = vi.hoisted(() => ({
  recordDismissedCandidateMock: vi.fn(),
  listDismissedDomainsMock: vi.fn(),
}));

vi.mock("@/agents/discovery-search/memory-store", () => ({
  recordDismissedCandidate: recordDismissedCandidateMock,
  listDismissedDomains: listDismissedDomainsMock,
}));

const { getCompanyContextMock } = vi.hoisted(() => ({
  getCompanyContextMock: vi.fn().mockResolvedValue(""),
}));

vi.mock("@/lib/company-context", () => ({ getCompanyContext: getCompanyContextMock }));

const { duckDuckGoInvokeMock, duckDuckGoSearchMock } = vi.hoisted(() => {
  const duckDuckGoInvokeMock = vi
    .fn()
    .mockResolvedValue('[{"title":"Acme","link":"https://acme.com"}]');
  class DuckDuckGoSearchMockClass {
    invoke = duckDuckGoInvokeMock;
  }
  return { duckDuckGoInvokeMock, duckDuckGoSearchMock: DuckDuckGoSearchMockClass };
});

vi.mock("@langchain/community/tools/duckduckgo_search", () => ({
  DuckDuckGoSearch: duckDuckGoSearchMock,
}));

const { retrieveSignalsInvokeMock } = vi.hoisted(() => ({
  retrieveSignalsInvokeMock: vi.fn().mockResolvedValue("[]"),
}));

vi.mock("@/retrieval/hybrid-retrieve-tool", async () => {
  const { tool } = await import("@langchain/core/tools");
  const { z } = await import("zod");
  return {
    retrievalTool: tool(async () => retrieveSignalsInvokeMock(), {
      name: "retrieve_signals",
      description: "Search Signal's stored signals.",
      schema: z.object({ query: z.string() }),
    }),
  };
});

const { selectModelMock } = vi.hoisted(() => ({
  selectModelMock: vi.fn((preferredModel: string) => Promise.resolve(preferredModel)),
}));

vi.mock("@/llm/adaptive-router", () => ({
  selectModel: selectModelMock,
  ANTHROPIC_MODEL_IDS: {
    "claude-haiku": "claude-haiku-4-5-20251001",
    "claude-sonnet": "claude-sonnet-5",
  },
}));

const { withCircuitBreakerMock } = vi.hoisted(() => ({
  withCircuitBreakerMock: vi.fn((_service: string, fn: () => unknown) => fn()),
}));

vi.mock("@/reliability/circuit-breaker", () => ({
  withCircuitBreaker: withCircuitBreakerMock,
}));

const { modelInvokeMock, chatAnthropicMock } = vi.hoisted(() => {
  const modelInvokeMock = vi.fn();
  class ChatAnthropicMockClass {
    bindTools() {
      return { invoke: modelInvokeMock };
    }
  }
  return { modelInvokeMock, chatAnthropicMock: vi.fn(ChatAnthropicMockClass) };
});

vi.mock("@langchain/anthropic", () => ({ ChatAnthropic: chatAnthropicMock }));

import {
  DISCOVERY_RECURSION_LIMIT,
  confirmNode,
  setupDiscoveryCheckpointer,
  discoveryGraph,
} from "@/agents/discovery-search/discovery-graph";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";

function toolCall(name: string, args: Record<string, unknown>, id: string) {
  return { name, args, id, type: "tool_call" as const };
}

function aiWithToolCalls(calls: ReturnType<typeof toolCall>[]) {
  return new AIMessage({ content: "", tool_calls: calls });
}

function aiFinal(json: string) {
  return new AIMessage({ content: json, tool_calls: [] });
}

const CANDIDATES_JSON = JSON.stringify({
  candidates: [{ name: "Acme", domain: "acme.com", reason: "same ICP" }],
});

function invokeGraph(threadId: string) {
  return discoveryGraph.invoke(
    { workspace_id: WORKSPACE_ID },
    {
      configurable: { thread_id: threadId },
      recursionLimit: DISCOVERY_RECURSION_LIMIT,
    }
  );
}

describe("discovery-graph", () => {
  beforeAll(async () => {
    await setupDiscoveryCheckpointer();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getCompanyContextMock.mockResolvedValue("");
    selectModelMock.mockImplementation((m: string) => Promise.resolve(m));
    duckDuckGoInvokeMock.mockResolvedValue('[{"title":"Acme","link":"https://acme.com"}]');
    retrieveSignalsInvokeMock.mockResolvedValue("[]");
    createTrackedEntityCandidateMock.mockResolvedValue({ id: "te-1" });
    recordDismissedCandidateMock.mockResolvedValue(undefined);
    listDismissedDomainsMock.mockResolvedValue([]);
    interruptMock.mockReturnValue("dismiss");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exports a positive recursion limit", () => {
    expect(typeof DISCOVERY_RECURSION_LIMIT).toBe("number");
    expect(DISCOVERY_RECURSION_LIMIT).toBeGreaterThan(0);
  });

  it("confirmNode writes a candidate with status 'candidate' on a confirm decision", async () => {
    interruptMock.mockReturnValue("confirm");
    const state = {
      workspace_id: WORKSPACE_ID,
      candidates: [{ name: "Acme", domain: "acme.com", reason: "same ICP" }],
    };

    await confirmNode(state as never);

    expect(interruptMock).toHaveBeenCalledWith({
      type: "confirm_candidate",
      candidate: { name: "Acme", domain: "acme.com", reason: "same ICP" },
    });
    expect(createTrackedEntityCandidateMock).toHaveBeenCalledTimes(1);
    expect(createTrackedEntityCandidateMock).toHaveBeenCalledWith({
      workspace_id: WORKSPACE_ID,
      candidate_name: "Acme",
      candidate_domain: "acme.com",
      candidate_reason: "same ICP",
      source: "discovered",
      status: "candidate",
    });
    expect(recordDismissedCandidateMock).not.toHaveBeenCalled();
  });

  it("confirmNode writes nothing for a dismissed candidate", async () => {
    interruptMock.mockReturnValue("dismiss");
    const state = {
      workspace_id: WORKSPACE_ID,
      candidates: [{ name: "Acme", domain: "acme.com", reason: "same ICP" }],
    };

    await confirmNode(state as never);

    expect(interruptMock).toHaveBeenCalledTimes(1);
    expect(createTrackedEntityCandidateMock).not.toHaveBeenCalled();
    expect(recordDismissedCandidateMock).toHaveBeenCalledWith(WORKSPACE_ID, "acme.com");
  });

  dbIt("injects dismissed domains into the system prompt", async () => {
    listDismissedDomainsMock.mockResolvedValue(["acme.com"]);
    modelInvokeMock.mockResolvedValueOnce(aiFinal(CANDIDATES_JSON));

    await invokeGraph(randomUUID());

    const firstInvokeArgs = modelInvokeMock.mock.calls[0][0] as [string, string][];
    const systemContent = firstInvokeArgs[0][1];
    expect(systemContent).toContain("do not re-propose");
    expect(systemContent).toContain("acme.com");
  });

  dbIt("round-trips through the ToolNode twice before reaching confirmNode", async () => {
    modelInvokeMock
      .mockResolvedValueOnce(aiWithToolCalls([toolCall("web_search", { query: "competitors" }, "call-1")]))
      .mockResolvedValueOnce(aiWithToolCalls([toolCall("retrieve_signals", { query: "competitors" }, "call-2")]))
      .mockResolvedValueOnce(aiFinal(CANDIDATES_JSON));

    await invokeGraph(randomUUID());

    // Model invoked once per llmCall hop: initial, after search, after retrieve.
    expect(modelInvokeMock).toHaveBeenCalledTimes(3);
    // Each tool executed exactly once — proves the loop round-trips through
    // ToolNode (not just that the graph compiled).
    expect(duckDuckGoInvokeMock).toHaveBeenCalledTimes(1);
    expect(retrieveSignalsInvokeMock).toHaveBeenCalledTimes(1);
    // The final (non-tool-call) answer's candidates reached the confirm gate.
    expect(interruptMock).toHaveBeenCalledWith({
      type: "confirm_candidate",
      candidate: { name: "Acme", domain: "acme.com", reason: "same ICP" },
    });
  });

  dbIt("stops at the iteration cap and reaches confirmNode with partial results instead of throwing", async () => {
    // The model keeps asking for a search every turn — the soft cap must stop
    // the loop and route to confirm (empty candidates) rather than erroring.
    modelInvokeMock.mockImplementation(() =>
      Promise.resolve(aiWithToolCalls([toolCall("web_search", { query: "competitors" }, "call-1")]))
    );

    await invokeGraph(randomUUID());

    // MAX_ITERATIONS = 5 llmCall invocations, never a GraphRecursionError.
    expect(modelInvokeMock).toHaveBeenCalledTimes(5);
    expect(interruptMock).not.toHaveBeenCalled();
  });
});
