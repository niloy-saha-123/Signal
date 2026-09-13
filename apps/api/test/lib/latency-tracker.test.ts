import { describe, it, expect, vi, beforeEach } from "vitest";

const { loggerErrorMock } = vi.hoisted(() => ({ loggerErrorMock: vi.fn() }));

vi.mock("@/db/client", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    select: vi.fn(),
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerErrorMock } }));

import { db } from "@/db/client";
import { trackLatency, computePercentiles } from "@/lib/latency-tracker";

describe("trackLatency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns fn's result and records a success row", async () => {
    const fn = vi.fn().mockResolvedValue("agent-output");
    const result = await trackLatency(
      "intent_analyzer",
      {
        competitorId: "550e8400-e29b-41d4-a716-446655440000",
        identity: { kind: "run", runId: "550e8400-e29b-41d4-a716-446655440001" },
      },
      fn
    );
    expect(result).toBe("agent-output");
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain("db down");
    const values = (db.insert as ReturnType<typeof vi.fn>).mock.results[0]?.value.values;
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      run_id: "550e8400-e29b-41d4-a716-446655440001",
      job_id: null,
    }));
  });

  it("records a failed row and re-throws when fn rejects", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("agent crashed"));
    await expect(
      trackLatency(
        "synthesis",
        {
          competitorId: "550e8400-e29b-41d4-a716-446655440000",
          identity: { kind: "job", jobId: "analysis-job-42" },
        },
        fn
      )
    ).rejects.toThrow("agent crashed");
    const values = (db.insert as ReturnType<typeof vi.fn>).mock.results[0]?.value.values;
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      run_id: null,
      job_id: "analysis-job-42",
      status: "failed",
    }));
  });

  it("still returns fn's result when the success-path insert throws", async () => {
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      values: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const fn = vi.fn().mockResolvedValue("agent-output");
    const result = await trackLatency(
      "intent_analyzer",
      {
        competitorId: "550e8400-e29b-41d4-a716-446655440000",
        identity: { kind: "run", runId: "550e8400-e29b-41d4-a716-446655440001" },
      },
      fn
    );
    expect(result).toBe("agent-output");
  });

  it("still throws fn's original error when the failure-path insert also throws", async () => {
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      values: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const fn = vi.fn().mockRejectedValue(new Error("agent crashed"));
    await expect(
      trackLatency(
        "synthesis",
        {
          competitorId: "550e8400-e29b-41d4-a716-446655440000",
          identity: { kind: "job", jobId: "analysis-job-42" },
        },
        fn
      )
    ).rejects.toThrow("agent crashed");
  });

  it("rejects a missing or blank latency identity before running work", async () => {
    const fn = vi.fn().mockResolvedValue("must-not-run");
    await expect(
      trackLatency(
        "synthesis",
        { competitorId: "550e8400-e29b-41d4-a716-446655440000", identity: undefined } as never,
        fn
      )
    ).rejects.toThrow(/telemetry identity/i);
    await expect(
      trackLatency(
        "synthesis",
        {
          competitorId: "550e8400-e29b-41d4-a716-446655440000",
          identity: { kind: "job", jobId: "   " },
        },
        fn
      )
    ).rejects.toThrow(/telemetry identity/i);
    expect(fn).not.toHaveBeenCalled();
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
