import { describe, it, expect, vi, beforeEach } from "vitest";

// Drizzle's builder is chained, so the mock mirrors the chain and resolves at
// .where() / .orderBy() the way the real query does.
const { selectRowsMock } = vi.hoisted(() => ({ selectRowsMock: vi.fn() }));

vi.mock("@/db/client", () => {
  const chain = {
    from: () => chain,
    where: (..._args: unknown[]) => selectRowsMock(),
  };
  return { db: { select: () => chain } };
});

import { getCalibration } from "@/db/queries";

const WORKSPACE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("getCalibration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports no track record rather than a perfect one for a workspace with nothing resolved", async () => {
    // Review Focus #5. A zero Brier score is a flawless score. "Nothing has
    // resolved yet" and "we have never been wrong" must never be the same value.
    selectRowsMock.mockResolvedValue([]);

    const calibration = await getCalibration(WORKSPACE_ID);

    expect(calibration.resolved_count).toBe(0);
    expect(calibration.brier).toBeNull();
    expect(calibration.buckets).toEqual([]);
    expect(calibration.baseline_brier).toBeCloseTo(0.25, 10);
  });

  it("scores the resolved predictions it is given", async () => {
    selectRowsMock.mockResolvedValue([
      { probability: 0.9, status: "hit" },
      { probability: 0.9, status: "miss" },
    ]);

    const calibration = await getCalibration(WORKSPACE_ID);

    expect(calibration.resolved_count).toBe(2);
    expect(calibration.brier).toBeCloseTo(0.41, 10);
  });

  it("ignores predictions that are open, unresolved or void", async () => {
    // The query must never hand unscoreable rows to computeCalibration — an
    // `unresolved` treated as a miss would let a quiet competitor damage the
    // score, and a `void` would let a human's bookkeeping move it.
    selectRowsMock.mockResolvedValue([
      { probability: 0.8, status: "hit" },
      { probability: 0.8, status: "unresolved" },
      { probability: 0.8, status: "void" },
      { probability: 0.8, status: "open" },
    ]);

    const calibration = await getCalibration(WORKSPACE_ID);

    expect(calibration.resolved_count).toBe(1);
    // Only the hit: (0.8 - 1)^2
    expect(calibration.brier).toBeCloseTo(0.04, 10);
  });
});
