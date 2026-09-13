import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/llm/cost-tracker", () => ({
  getDailySpend: vi.fn(),
}));

import { getDailySpend } from "@/llm/cost-tracker";
import { getDailyBudget, selectModel } from "@/llm/adaptive-router";

describe("selectModel", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DAILY_BUDGET_USD = "2.00";
  });

  it("returns the preferred model when under budget", async () => {
    (getDailySpend as ReturnType<typeof vi.fn>).mockResolvedValue(0.5);
    expect(await selectModel("gpt-4.1", true)).toBe("gpt-4.1");
  });

  it("downgrades to the cheaper same-provider model when over budget and eligible", async () => {
    (getDailySpend as ReturnType<typeof vi.fn>).mockResolvedValue(2.5);
    expect(await selectModel("gpt-4.1", true)).toBe("gpt-4o-mini");
    expect(await selectModel("claude-sonnet", true)).toBe("claude-haiku");
  });

  it("does not downgrade when the call is marked ineligible, even over budget", async () => {
    (getDailySpend as ReturnType<typeof vi.fn>).mockResolvedValue(2.5);
    expect(await selectModel("gpt-4.1", false)).toBe("gpt-4.1");
  });

  it("returns an already-cheap model unchanged even over budget", async () => {
    (getDailySpend as ReturnType<typeof vi.fn>).mockResolvedValue(2.5);
    expect(await selectModel("gpt-4o-mini", true)).toBe("gpt-4o-mini");
  });

  it.each(["not-a-number", "Infinity", "-0.01", "", "  "])(
    "rejects unsafe DAILY_BUDGET_USD values: %j",
    async (value) => {
      vi.stubEnv("DAILY_BUDGET_USD", value);
      (getDailySpend as ReturnType<typeof vi.fn>).mockResolvedValue(2.5);
      await expect(selectModel("gpt-4.1", true)).rejects.toThrow(/DAILY_BUDGET_USD/);
    }
  );

  it("preserves a zero daily budget as an immediate downgrade boundary", async () => {
    vi.stubEnv("DAILY_BUDGET_USD", "0");
    (getDailySpend as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    expect(getDailyBudget()).toBe(0);
    expect(await selectModel("gpt-4.1", true)).toBe("gpt-4o-mini");
  });
});
