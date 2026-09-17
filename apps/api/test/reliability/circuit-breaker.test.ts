import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/redis-client", () => ({
  cacheRedis: { get: vi.fn(), set: vi.fn(), incr: vi.fn(), del: vi.fn() },
}));
vi.mock("@/db/client", () => ({
  db: { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) },
}));

import { cacheRedis } from "@/lib/redis-client";
import { db } from "@/db/client";
import {
  getCircuitState,
  recordFailure,
  recordSuccess,
  isCircuitOpen,
  withCircuitBreaker,
} from "@/reliability/circuit-breaker";

describe("circuit breaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to closed when no state is set in Redis", async () => {
    (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const state = await getCircuitState("reddit");
    expect(state).toBe("closed");
  });

  it("opens the circuit after 5 recorded failures and logs a circuit_events row", async () => {
    (cacheRedis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    await recordFailure("reddit", "timeout");
    expect(cacheRedis.set).toHaveBeenCalledWith(
      "circuit:reddit:state",
      "open",
      expect.anything(),
      expect.anything()
    );
    expect(db.insert).toHaveBeenCalled();
  });

  it("does not open the circuit before 5 failures", async () => {
    (cacheRedis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    await recordFailure("reddit", "timeout");
    expect(cacheRedis.set).not.toHaveBeenCalledWith(
      "circuit:reddit:state",
      "open",
      expect.anything(),
      expect.anything()
    );
  });

  it("recordSuccess resets the failure counter and closes the circuit", async () => {
    await recordSuccess("reddit");
    expect(cacheRedis.del).toHaveBeenCalledWith("circuit:reddit:failures");
    expect(cacheRedis.set).toHaveBeenCalledWith("circuit:reddit:state", "closed");
  });

  it("isCircuitOpen returns true only when state is open", async () => {
    (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue("open");
    expect(await isCircuitOpen("reddit")).toBe(true);

    (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue("closed");
    expect(await isCircuitOpen("reddit")).toBe(false);
  });

  describe("half-open trial claim (stale open-state expiry)", () => {
    it("lets only one of two concurrent callers through as half_open when the failure counter is still >= threshold", async () => {
      (cacheRedis.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
        if (key === "circuit:reddit:state") return Promise.resolve(null); // open TTL expired
        if (key === "circuit:reddit:failures") return Promise.resolve("5"); // still high
        return Promise.resolve(null);
      });
      (cacheRedis.set as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce("OK") // first caller claims the trial
        .mockResolvedValueOnce(null); // second caller loses the race

      const [first, second] = await Promise.all([
        getCircuitState("reddit"),
        getCircuitState("reddit"),
      ]);

      const states = [first, second].sort();
      expect(states).toEqual(["half_open", "open"]);
      expect(cacheRedis.set).toHaveBeenCalledWith(
        "circuit:reddit:half_open",
        "1",
        "EX",
        10,
        "NX"
      );
    });

    it("returns closed when the open-state key is missing and the failure counter is below threshold", async () => {
      (cacheRedis.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
        if (key === "circuit:reddit:state") return Promise.resolve(null);
        if (key === "circuit:reddit:failures") return Promise.resolve("2");
        return Promise.resolve(null);
      });
      const state = await getCircuitState("reddit");
      expect(state).toBe("closed");
      expect(cacheRedis.set).not.toHaveBeenCalled();
    });
  });

  describe("recordFailure during an active half-open trial", () => {
    it("re-opens the circuit immediately instead of requiring 5 fresh failures", async () => {
      (cacheRedis.del as ReturnType<typeof vi.fn>).mockResolvedValue(1); // half-open key existed and was claimed
      await recordFailure("reddit", "trial request failed");

      expect(cacheRedis.del).toHaveBeenCalledWith("circuit:reddit:half_open");
      expect(cacheRedis.set).toHaveBeenCalledWith(
        "circuit:reddit:state",
        "open",
        "EX",
        60
      );
      expect(cacheRedis.incr).not.toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe("withCircuitBreaker", () => {
    it("returns fn's result and records success when the call completes", async () => {
      (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await withCircuitBreaker("reddit", async () => "ok");
      expect(result).toBe("ok");
      expect(cacheRedis.del).toHaveBeenCalledWith("circuit:reddit:failures");
    });

    it("short-circuits without invoking fn when the circuit is open", async () => {
      (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue("open");
      const fn = vi.fn();
      await expect(withCircuitBreaker("reddit", fn)).rejects.toThrow(/circuit is open/);
      expect(fn).not.toHaveBeenCalled();
    });

    it("records failure and rethrows the original error when fn throws", async () => {
      (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (cacheRedis.del as ReturnType<typeof vi.fn>).mockResolvedValue(0); // no half-open trial active
      (cacheRedis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      const original = new Error("upstream timeout");
      await expect(withCircuitBreaker("reddit", async () => { throw original; })).rejects.toBe(original);
      expect(cacheRedis.incr).toHaveBeenCalledWith("circuit:reddit:failures");
    });
  });
});
