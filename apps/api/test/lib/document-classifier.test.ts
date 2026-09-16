import { describe, it, expect, vi } from "vitest";
import { classifyDocument } from "../../src/lib/document-classifier";

vi.mock("@langchain/anthropic");

describe("classifyDocument", () => {
  it("routes narrative content to embedding mode", async () => {
    const result = await classifyDocument(
      "Our company was founded in 2022 to help small teams..."
    );
    expect(result.mode).toBe("narrative");
  });

  it("routes a pricing table to structured mode with extracted pricing_tiers", async () => {
    const result = await classifyDocument(
      "Starter: $29/month\nPro: $99/month\nEnterprise: contact us"
    );
    expect(result.mode).toBe("structured");
    expect(result.structured_fields?.pricing_tiers).toBeDefined();
  });
});
