import { describe, it, expect, vi, beforeEach } from "vitest";

const { loggerErrorMock } = vi.hoisted(() => ({ loggerErrorMock: vi.fn() }));

vi.mock("@/db/client", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    select: vi.fn(),
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerErrorMock } }));

import { db } from "@/db/client";
import { trackCost, getDailySpend } from "@/llm/cost-tracker";

describe("trackCost", () => {
  beforeEach(() => vi.clearAllMocks());

  it("computes cost for gpt-4o-mini and inserts a llm_costs row", async () => {
    const cost = await trackCost("intent_analyzer", "gpt-4o-mini", 1000, 500, {
      competitorId: "550e8400-e29b-41d4-a716-446655440000",
      identity: { kind: "run", runId: "550e8400-e29b-41d4-a716-446655440001" },
    });
    // (1000/1_000_000 * 0.15) + (500/1_000_000 * 0.60) = 0.00015 + 0.0003 = 0.00045
    expect(cost).toBeCloseTo(0.00045, 6);
    const values = (db.insert as ReturnType<typeof vi.fn>).mock.results[0]?.value.values;
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      run_id: "550e8400-e29b-41d4-a716-446655440001",
      job_id: null,
    }));
  });

  it("uses the reviewed GPT-4.1 production price", async () => {
    const cost = await trackCost("pattern_detector", "gpt-4.1", 1_000_000, 500_000, {
      competitorId: null,
      identity: { kind: "job", jobId: "entity-job-42" },
    });
    // $2.00 input + 0.5 * $8.00 output.
    expect(cost).toBeCloseTo(6, 6);
    const values = (db.insert as ReturnType<typeof vi.fn>).mock.results[0]?.value.values;
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: null, job_id: "entity-job-42" })
    );
  });

  it("computes cost for claude-sonnet correctly at a different price point", async () => {
    const cost = await trackCost("synthesis", "claude-sonnet", 2000, 1000, {
      competitorId: null,
      identity: { kind: "unattributed" },
    });
    // (2000/1_000_000 * 3.00) + (1000/1_000_000 * 15.00) = 0.006 + 0.015 = 0.021
    expect(cost).toBeCloseTo(0.021, 6);
    const values = (db.insert as ReturnType<typeof vi.fn>).mock.results[0]?.value.values;
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ run_id: null, job_id: null }));
  });

  it("throws for an unrecognized model rather than silently recording $0", async () => {
    await expect(trackCost("synthesis", "gpt-5-turbo-ultra", 100, 100)).rejects.toThrow();
  });

  it("keeps telemetry write failures non-fatal without logging connection details", async () => {
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      values: vi.fn().mockRejectedValue(new Error("postgres://secret@host/database")),
    });
    await expect(
      trackCost("synthesis", "gpt-4o-mini", 100, 20, {
        competitorId: null,
        identity: { kind: "job", jobId: "job-1" },
      })
    ).resolves.toBeGreaterThan(0);
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain("postgres://");
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
