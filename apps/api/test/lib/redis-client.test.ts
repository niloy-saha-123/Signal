import { describe, it, expect } from "vitest";
import { redis } from "@/lib/redis-client";

describe("redis client", () => {
  it("exports an ioredis instance with get/set/setex", () => {
    expect(redis).toBeDefined();
    expect(typeof redis.get).toBe("function");
    expect(typeof redis.set).toBe("function");
    expect(typeof redis.setex).toBe("function");
  });
});
