import { describe, it, expect, vi, beforeEach } from "vitest";

const { trackCostMock } = vi.hoisted(() => ({
  trackCostMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/llm/cost-tracker", () => ({
  trackCost: trackCostMock,
}));

const { invokeMock, withStructuredOutputMock, chatAnthropicMock } = vi.hoisted(() => {
  const invokeMock = vi.fn();
  const withStructuredOutputMock = vi.fn(() => ({ invoke: invokeMock }));
  // Real class as the mock implementation (same pattern as sentiment-clusterer.test.ts) —
  // an arrow-function mockImplementation can't be `new`'d, which is exactly what
  // classifyDocument does with ChatAnthropic.
  class ChatAnthropicMockClass {
    withStructuredOutput = withStructuredOutputMock;
  }
  const chatAnthropicMock = vi.fn(ChatAnthropicMockClass);
  return { invokeMock, withStructuredOutputMock, chatAnthropicMock };
});

vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: chatAnthropicMock,
}));

import { classifyDocument } from "../../src/lib/document-classifier";

function invokeResult(parsed: unknown) {
  return {
    raw: { usage_metadata: { input_tokens: 50, output_tokens: 10 } },
    parsed,
  };
}

describe("classifyDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes narrative content to embedding mode", async () => {
    invokeMock.mockResolvedValue(invokeResult({ doc_type: "other", mode: "narrative" }));

    const result = await classifyDocument(
      "Our company was founded in 2022 to help small teams..."
    );

    expect(result.mode).toBe("narrative");
    expect(withStructuredOutputMock).toHaveBeenCalled();
    expect(trackCostMock).toHaveBeenCalledWith("entity_extractor", "claude-haiku", 50, 10);
  });

  it("routes a pricing table to structured mode with extracted pricing_tiers", async () => {
    const pricing_tiers = [
      { name: "Starter", price: 29, billing: "monthly" },
      { name: "Pro", price: 99, billing: "monthly" },
    ];
    invokeMock.mockResolvedValue(
      invokeResult({ doc_type: "other", mode: "structured", structured_fields: { pricing_tiers } })
    );

    const result = await classifyDocument(
      "Starter: $29/month\nPro: $99/month\nEnterprise: contact us"
    );

    expect(result.mode).toBe("structured");
    expect(result.structured_fields?.pricing_tiers).toEqual(pricing_tiers);
    expect(trackCostMock).toHaveBeenCalledWith("entity_extractor", "claude-haiku", 50, 10);
  });

  it("falls back to the keyword heuristic when the LLM call throws", async () => {
    invokeMock.mockRejectedValue(new Error("anthropic api error"));

    const result = await classifyDocument("Starter: $29/month\nPro: $99/month");

    expect(result.mode).toBe("structured");
    expect(result.structured_fields?.pricing_tiers).toBeDefined();
    expect(trackCostMock).not.toHaveBeenCalled();
  });
});
