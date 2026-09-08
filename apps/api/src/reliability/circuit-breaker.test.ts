import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/redis-client", () => ({
  redis: { get: vi.fn(), set: vi.fn(), incr: vi.fn(), del: vi.fn() },
}));
vi.mock("../db/client", () => ({
  db: { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) },
}));

import { redis } from "../lib/redis-client";
import { db } from "../db/client";
import { getCircuitState, recordFailure, recordSuccess, isCircuitOpen } from "./circuit-breaker";

describe("circuit breaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to closed when no state is set in Redis", async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const state = await getCircuitState("reddit");
    expect(state).toBe("closed");
  });

  it("opens the circuit after 5 recorded failures and logs a circuit_events row", async () => {
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    await recordFailure("reddit", "timeout");
    expect(redis.set).toHaveBeenCalledWith(
      "circuit:reddit:state",
      "open",
      expect.anything(),
      expect.anything()
    );
    expect(db.insert).toHaveBeenCalled();
  });

  it("does not open the circuit before 5 failures", async () => {
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    await recordFailure("reddit", "timeout");
    expect(redis.set).not.toHaveBeenCalledWith(
      "circuit:reddit:state",
      "open",
      expect.anything(),
      expect.anything()
    );
  });

  it("recordSuccess resets the failure counter and closes the circuit", async () => {
    await recordSuccess("reddit");
    expect(redis.del).toHaveBeenCalledWith("circuit:reddit:failures");
    expect(redis.set).toHaveBeenCalledWith("circuit:reddit:state", "closed");
  });

  it("isCircuitOpen returns true only when state is open", async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue("open");
    expect(await isCircuitOpen("reddit")).toBe(true);

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue("closed");
    expect(await isCircuitOpen("reddit")).toBe(false);
  });
});
