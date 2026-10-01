import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));
const { listCompetitorsMock } = vi.hoisted(() => ({
  listCompetitorsMock: vi.fn(),
}));
vi.mock("@/db/queries", () => ({ listCompetitors: listCompetitorsMock }));
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  isCircuitOpen,
  recordFailure,
  recordSuccess,
} from "@/reliability/circuit-breaker";
import { runSourceSweep } from "@/collectors/sweep";

const c = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    name: id,
    is_active: true,
    feed: `https://${id}.dev/feed`,
    ...extra,
  }) as any;

describe("runSourceSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isCircuitOpen).mockResolvedValue(false);
  });

  it("throws without listing competitors when the circuit is already open", async () => {
    vi.mocked(isCircuitOpen).mockResolvedValueOnce(true);
    await expect(runSourceSweep("news", () => "x", vi.fn())).rejects.toThrow(
      /circuit is open/,
    );
    expect(listCompetitorsMock).not.toHaveBeenCalled();
  });

  it("skips inactive and unconfigured competitors, passes config, records success", async () => {
    listCompetitorsMock.mockResolvedValue([
      c("a"),
      c("b", { is_active: false }),
      c("d", { feed: null }),
    ]);
    const collect = vi.fn().mockResolvedValue(undefined);
    await runSourceSweep("news", (x: any) => x.feed, collect);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }),
      "https://a.dev/feed",
    );
    expect(recordSuccess).toHaveBeenCalledWith("news");
  });

  it("continues past a failing competitor and records failure, not success", async () => {
    listCompetitorsMock.mockResolvedValue([c("a"), c("b")]);
    const collect = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    await runSourceSweep("news", (x: any) => x.feed, collect);
    expect(collect).toHaveBeenCalledTimes(2);
    expect(recordFailure).toHaveBeenCalledWith("news", "boom");
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("stops when the circuit trips mid-run and does not record success", async () => {
    listCompetitorsMock.mockResolvedValue([c("a"), c("b")]);
    vi.mocked(isCircuitOpen)
      .mockResolvedValueOnce(false) // start
      .mockResolvedValueOnce(false) // before a
      .mockResolvedValueOnce(true); // before b
    const collect = vi.fn().mockResolvedValue(undefined);
    await runSourceSweep("news", (x: any) => x.feed, collect);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("records failure and rethrows when listing competitors fails", async () => {
    listCompetitorsMock.mockRejectedValue(new Error("db down"));
    await expect(runSourceSweep("news", () => "x", vi.fn())).rejects.toThrow(
      "db down",
    );
    expect(recordFailure).toHaveBeenCalledWith("news", "db down");
  });
});
