import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    select: vi.fn(),
  },
}));

import { db } from "../db/client";
import { trackLatency, computePercentiles } from "./latency-tracker";

describe("trackLatency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns fn's result and records a success row", async () => {
    const fn = vi.fn().mockResolvedValue("agent-output");
    const result = await trackLatency(
      "intent_analyzer",
      "550e8400-e29b-41d4-a716-446655440000",
      "550e8400-e29b-41d4-a716-446655440001",
      fn
    );
    expect(result).toBe("agent-output");
    expect(db.insert).toHaveBeenCalled();
  });

  it("records a failed row and re-throws when fn rejects", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("agent crashed"));
    await expect(
      trackLatency(
        "synthesis",
        "550e8400-e29b-41d4-a716-446655440000",
        "550e8400-e29b-41d4-a716-446655440001",
        fn
      )
    ).rejects.toThrow("agent crashed");
    expect(db.insert).toHaveBeenCalled();
  });
});

describe("computePercentiles", () => {
  it("computes p50/p95/p99/mean via nearest-rank on sorted durations", async () => {
    const durations = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(durations.map((duration_ms) => ({ duration_ms }))),
      }),
    });

    const result = await computePercentiles("intent_analyzer", 7);
    expect(result.agent_name).toBe("intent_analyzer");
    expect(result.sample_count).toBe(10);
    expect(result.p50).toBe(500);
    expect(result.mean).toBe(550);
  });

  it("returns zeroed stats when there are no samples", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await computePercentiles("synthesis", 7);
    expect(result.sample_count).toBe(0);
    expect(result.p50).toBe(0);
  });
});
