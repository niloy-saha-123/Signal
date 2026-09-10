import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./cost-tracker", () => ({
  getDailySpend: vi.fn(),
}));

import { getDailySpend } from "./cost-tracker";
import { selectModel } from "./adaptive-router";

describe("selectModel", () => {
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

  it("falls back to the default budget instead of NaN when DAILY_BUDGET_USD is malformed", async () => {
    process.env.DAILY_BUDGET_USD = "not-a-number";
    (getDailySpend as ReturnType<typeof vi.fn>).mockResolvedValue(2.5);
    // Default budget is 2.0 — spend of 2.5 must still trigger a downgrade,
    // proving the comparison isn't silently `spend >= NaN` (always false).
    expect(await selectModel("gpt-4.1", true)).toBe("gpt-4o-mini");
  });
});
