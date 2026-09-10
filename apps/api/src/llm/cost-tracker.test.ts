import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    select: vi.fn(),
  },
}));

import { db } from "../db/client";
import { trackCost, getDailySpend } from "./cost-tracker";

describe("trackCost", () => {
  beforeEach(() => vi.clearAllMocks());

  it("computes cost for gpt-4o-mini and inserts a llm_costs row", async () => {
    const cost = await trackCost("intent_analyzer", "gpt-4o-mini", 1000, 500);
    // (1000/1_000_000 * 0.15) + (500/1_000_000 * 0.60) = 0.00015 + 0.0003 = 0.00045
    expect(cost).toBeCloseTo(0.00045, 6);
    expect(db.insert).toHaveBeenCalled();
  });

  it("uses the reviewed GPT-4.1 production price", async () => {
    const cost = await trackCost("pattern_detector", "gpt-4.1", 1_000_000, 500_000);
    // $2.00 input + 0.5 * $8.00 output.
    expect(cost).toBeCloseTo(6, 6);
  });

  it("computes cost for claude-sonnet correctly at a different price point", async () => {
    const cost = await trackCost("synthesis", "claude-sonnet", 2000, 1000);
    // (2000/1_000_000 * 3.00) + (1000/1_000_000 * 15.00) = 0.006 + 0.015 = 0.021
    expect(cost).toBeCloseTo(0.021, 6);
  });

  it("throws for an unrecognized model rather than silently recording $0", async () => {
    await expect(trackCost("synthesis", "gpt-5-turbo-ultra", 100, 100)).rejects.toThrow();
  });
});

describe("getDailySpend", () => {
  it("sums cost_usd across today's rows", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ cost_usd: "0.05" }, { cost_usd: "0.10" }]),
      }),
    });
    const spend = await getDailySpend();
    expect(spend).toBeCloseTo(0.15, 6);
  });

  it("returns 0 when there are no rows today", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });
    expect(await getDailySpend()).toBe(0);
  });

  it("fails safe to Infinity (never rejects, never 0) when the db read throws", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("connection reset")),
      }),
    });
    await expect(getDailySpend()).resolves.toBe(Infinity);
  });
});
