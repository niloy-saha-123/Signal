import { beforeEach, describe, expect, it, vi } from "vitest";

const { redisMock, cacheRedisMock, probeMock, redisConstructorMock } = vi.hoisted(() => {
  const redisMock = { on: vi.fn(), quit: vi.fn(), disconnect: vi.fn() };
  const probeMock = {
    on: vi.fn(),
    connect: vi.fn(),
    ping: vi.fn(),
    disconnect: vi.fn(),
  };
  const cacheRedisMock = {
    on: vi.fn(),
    quit: vi.fn(),
    disconnect: vi.fn(),
    duplicate: vi.fn(() => probeMock),
  };
  let constructorCall = 0;
  const redisConstructorMock = vi.fn(function RedisConstructorMock() {
    constructorCall += 1;
    return constructorCall === 1 ? redisMock : cacheRedisMock;
  });
  return { redisMock, cacheRedisMock, probeMock, redisConstructorMock };
});

vi.mock("ioredis", () => ({ default: redisConstructorMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { checkRedisReadiness } from "@/lib/redis-client";

describe("Redis readiness probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    probeMock.connect.mockRejectedValue(new Error("connection failed"));
  });

  it("suppresses raw client error emission and disconnects after failure", async () => {
    const controller = new AbortController();

    await expect(
      checkRedisReadiness({ timeoutMs: 25, signal: controller.signal })
    ).rejects.toThrow("connection failed");

    expect(cacheRedisMock.duplicate).toHaveBeenCalledWith(
      expect.objectContaining({ connectTimeout: 25, commandTimeout: 25 })
    );
    expect(probeMock.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(probeMock.disconnect).toHaveBeenCalledTimes(1);
  });
});
