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
    expect(await selectModel("gpt-4o", true)).toBe("gpt-4o");
  });

  it("downgrades to the cheaper same-provider model when over budget and eligible", async () => {
    (getDailySpend as ReturnType<typeof vi.fn>).mockResolvedValue(2.5);
    expect(await selectModel("gpt-4o", true)).toBe("gpt-4o-mini");
    expect(await selectModel("claude-sonnet", true)).toBe("claude-haiku");
  });

  it("does not downgrade when the call is marked ineligible, even over budget", async () => {
    (getDailySpend as ReturnType<typeof vi.fn>).mockResolvedValue(2.5);
    expect(await selectModel("gpt-4o", false)).toBe("gpt-4o");
  });

  it("returns an already-cheap model unchanged even over budget", async () => {
    (getDailySpend as ReturnType<typeof vi.fn>).mockResolvedValue(2.5);
    expect(await selectModel("gpt-4o-mini", true)).toBe("gpt-4o-mini");
  });
});
