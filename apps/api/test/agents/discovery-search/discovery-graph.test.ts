// Hermetic tests for the discovery graph — no network, no real Postgres.
// A dummy DATABASE_URL is set before import so discovery-graph's loadRootEnv()
// (which never overwrites an already-set var) can't inject the real Supabase
// URL into the checkpointer constructed at module load. The pg.Pool it wraps
// connects lazily, so nothing here touches a database.
process.env.DATABASE_URL = "postgres://signal:signal@localhost:5433/signal";

import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { getCompanyContextMock } = vi.hoisted(() => ({
  getCompanyContextMock: vi.fn().mockResolvedValue(""),
}));

vi.mock("@/lib/company-context", () => ({ getCompanyContext: getCompanyContextMock }));

const { tavilyInvokeMock } = vi.hoisted(() => ({
  tavilyInvokeMock: vi.fn().mockResolvedValue("fake search results"),
}));

const tavilySearchMock = vi.hoisted(() => {
  return class {
    invoke = tavilyInvokeMock;
  };
});

vi.mock("@langchain/tavily", () => ({ TavilySearch: tavilySearchMock }));

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

const { anthropicInvokeMock, chatAnthropicMock } = vi.hoisted(() => {
  const anthropicInvokeMock = vi.fn();
  const withStructuredOutputMock = vi.fn(() => ({ invoke: anthropicInvokeMock }));
  class ChatAnthropicMockClass {
    withStructuredOutput = withStructuredOutputMock;
  }
  return { anthropicInvokeMock, chatAnthropicMock: vi.fn(ChatAnthropicMockClass) };
});

vi.mock("@langchain/anthropic", () => ({ ChatAnthropic: chatAnthropicMock }));

import {
  DISCOVERY_RECURSION_LIMIT,
  confirmNode,
  searchNode,
} from "@/agents/discovery-search/discovery-graph";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";

describe("discovery-graph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCompanyContextMock.mockResolvedValue("");
    tavilyInvokeMock.mockResolvedValue("fake search results");
    selectModelMock.mockImplementation((m: string) => Promise.resolve(m));
    createTrackedEntityCandidateMock.mockResolvedValue({ id: "te-1" });
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
  });

  it("searchNode returns no candidates when the LLM produces no parsed result", async () => {
    anthropicInvokeMock.mockResolvedValue({ parsed: null });

    const result = await searchNode({ workspace_id: WORKSPACE_ID, candidates: [] } as never);

    expect(result).toEqual({ candidates: [] });
  });

  it("serializes Tavily results into readable text instead of [object Object]", async () => {
    tavilyInvokeMock.mockResolvedValue({
      query: "companies competing with...",
      results: [
        { title: "Acme Inc", content: "Sells competitor tracking", score: 0.9, raw_content: null },
      ],
      response_time: 0.1,
    });
    anthropicInvokeMock.mockResolvedValue({ parsed: { candidates: [] } });

    await searchNode({ workspace_id: WORKSPACE_ID, candidates: [] } as never);

    expect(anthropicInvokeMock).toHaveBeenCalledTimes(1);
    const messages = anthropicInvokeMock.mock.calls[0][0];
    const userMessage = messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("Acme Inc");
    expect(userMessage.content).toContain("Sells competitor tracking");
    expect(userMessage.content).not.toContain("[object Object]");
  });

  it("renders the Tavily error message when the search fails", async () => {
    tavilyInvokeMock.mockResolvedValue({ error: "Tavily API key not found" });
    anthropicInvokeMock.mockResolvedValue({ parsed: { candidates: [] } });

    await searchNode({ workspace_id: WORKSPACE_ID, candidates: [] } as never);

    const messages = anthropicInvokeMock.mock.calls[0][0];
    const userMessage = messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("Search error: Tavily API key not found");
  });
});