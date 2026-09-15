import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const {
  closeQueueMock,
  closeRedisMock,
  closeDatabaseMock,
  checkDatabaseReadinessMock,
  checkRedisReadinessMock,
} = vi.hoisted(() => ({
  closeQueueMock: vi.fn().mockResolvedValue(undefined),
  closeRedisMock: vi.fn().mockResolvedValue(undefined),
  closeDatabaseMock: vi.fn().mockResolvedValue(undefined),
  checkDatabaseReadinessMock: vi.fn().mockResolvedValue(undefined),
  checkRedisReadinessMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/queues/registry", () => ({
  queues: {
    analysis: { close: closeQueueMock },
    "collect-reddit": { close: closeQueueMock },
  },
}));
vi.mock("@/lib/redis-client", () => ({
  closeRedisConnections: closeRedisMock,
  checkRedisReadiness: checkRedisReadinessMock,
}));
const { wireSocketRelayMock } = vi.hoisted(() => ({
  wireSocketRelayMock: vi.fn(() => ({ close: vi.fn().mockResolvedValue(undefined) })),
}));
vi.mock("@/lib/socket-relay", () => ({ wireSocketRelay: wireSocketRelayMock }));
vi.mock("@/db/client", () => ({
  closeDatabase: closeDatabaseMock,
  checkDatabaseReadiness: checkDatabaseReadinessMock,
}));
vi.mock("@/api/competitors", () => ({ createCompetitorRouter: () => express.Router() }));
vi.mock("@/api/signals", () => ({ createSignalRouter: () => express.Router() }));
vi.mock("@/api/alerts", () => ({ createAlertRouter: () => express.Router() }));
vi.mock("@/api/chat", () => ({ createChatRouter: () => express.Router() }));
vi.mock("@/api/company-profile", () => ({ createCompanyProfileRouter: () => express.Router() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { apiErrorHandler, createApiApp, createApiRuntime, startApiFromEnvironment, validateApiEnvironment } from "@/api/index";

class FakeServer extends EventEmitter {
  listening = false;
  listen = vi.fn((_port: number, callback?: () => void) => {
    this.listening = true;
    callback?.();
    return this;
  });
  close = vi.fn((callback?: (error?: Error) => void) => {
    this.listening = false;
    callback?.();
    return this;
  });
  closeAllConnections = vi.fn();
}

describe("API runtime", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates required infrastructure and a bounded port", () => {
    expect(() => validateApiEnvironment({})).toThrow(/DATABASE_URL/);
    expect(() =>
      validateApiEnvironment({ DATABASE_URL: "postgres://db", REDIS_URL: "redis://cache", PORT: "0" })
    ).toThrow(/PORT/);
    expect(
      validateApiEnvironment({
        DATABASE_URL: "postgres://db",
        REDIS_URL: "redis://cache",
        PORT: "4100",
      })
    ).toEqual({ port: 4100 });
  });

  it("requires an exact production acknowledgement for the unauthenticated API", () => {
    const base = { DATABASE_URL: "postgres://db", REDIS_URL: "redis://cache", NODE_ENV: "production" };
    expect(() => validateApiEnvironment(base)).toThrow(/ALLOW_UNAUTHENTICATED_API/);
    expect(() => validateApiEnvironment({ ...base, ALLOW_UNAUTHENTICATED_API: "TRUE" })).toThrow(
      /ALLOW_UNAUTHENTICATED_API/
    );
    expect(validateApiEnvironment({ ...base, ALLOW_UNAUTHENTICATED_API: "true" })).toEqual({ port: 3000 });
    expect(validateApiEnvironment({ ...base, NODE_ENV: "development" })).toEqual({ port: 3000 });
  });

  it("mounts a bounded JSON parser and liveness route", () => {
    const app = createApiApp();
    expect(app).toBeDefined();
    expect(app._router.stack.length).toBeGreaterThan(1);
  });

  it("serves health and enforces the global JSON body limit", async () => {
    const app = createApiApp();
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok" });

      const oversized = await fetch(`http://127.0.0.1:${port}/api/competitors`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(110_000) }),
      });
      expect(oversized.status).toBe(413);
      expect(await oversized.json()).toEqual({ error: "payload_too_large" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps liveness independent and reports bounded dependency readiness", async () => {
    const app = createApiApp({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      checkRedis: vi.fn().mockRejectedValue(new Error("redis://secret@cache unavailable")),
      readinessTimeoutMs: 10,
    });
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
      const ready = await fetch(`http://127.0.0.1:${port}/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ status: "unavailable" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reports ready only after both dependency probes succeed", async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const checkRedis = vi.fn().mockResolvedValue(undefined);
    const app = createApiApp({ checkDatabase, checkRedis, readinessTimeoutMs: 10 });
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const ready = await fetch(`http://127.0.0.1:${port}/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({ status: "ready" });
      expect(checkDatabase).toHaveBeenCalledTimes(1);
      expect(checkRedis).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("times readiness out instead of hanging", async () => {
    let databaseAborted = false;
    const app = createApiApp({
      checkDatabase: ({ signal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            databaseAborted = true;
            reject(signal.reason);
          });
        }),
      checkRedis: vi.fn().mockResolvedValue(undefined),
      readinessTimeoutMs: 5,
    });
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const ready = await fetch(`http://127.0.0.1:${port}/ready`);
      expect(ready.status).toBe(503);
      expect(databaseAborted).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("uses resource-owned bounded readiness probes by default", async () => {
    const app = createApiApp({ readinessTimeoutMs: 25 });
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const ready = await fetch(`http://127.0.0.1:${port}/ready`);
      expect(ready.status).toBe(200);
      expect(checkDatabaseReadinessMock).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 25, signal: expect.any(AbortSignal) })
      );
      expect(checkRedisReadinessMock).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 25, signal: expect.any(AbortSignal) })
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("closes an owned runtime when production validation fails", async () => {
    const runtime = { start: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    await expect(
      startApiFromEnvironment(
        { DATABASE_URL: "postgres://db", REDIS_URL: "redis://cache", NODE_ENV: "production" },
        { createRuntime: () => runtime as never }
      )
    ).rejects.toThrow(/ALLOW_UNAUTHENTICATED_API/);
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("closes an owned runtime when server startup fails", async () => {
    const runtime = {
      start: vi.fn().mockRejectedValue(new Error("listen failed")),
      close: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      startApiFromEnvironment(
        {
          DATABASE_URL: "postgres://db",
          REDIS_URL: "redis://cache",
          NODE_ENV: "production",
          ALLOW_UNAUTHENTICATED_API: "true",
        },
        { createRuntime: () => runtime as never }
      )
    ).rejects.toThrow("listen failed");
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("maps parser size and syntax failures without leaking internals", () => {
    const response = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    apiErrorHandler({ type: "entity.too.large", status: 413 }, {} as any, response as any, vi.fn());
    expect(response.status).toHaveBeenCalledWith(413);
    expect(response.json).toHaveBeenCalledWith({ error: "payload_too_large" });

    response.status.mockClear();
    response.json.mockClear();
    apiErrorHandler({ type: "entity.parse.failed", status: 400 }, {} as any, response as any, vi.fn());
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: "invalid_json" });
  });

  it("starts and closes all owned resources exactly once", async () => {
    const server = new FakeServer();
    const io = { close: vi.fn((callback?: () => void) => callback?.()) };
    const runtime = createApiRuntime({
      server: server as any,
      io: io as any,
      closeQueues: async () => {
        await closeQueueMock();
      },
      closeRedis: closeRedisMock,
      closeDatabase: closeDatabaseMock,
    });

    await runtime.start(4100);
    expect(server.listen).toHaveBeenCalledWith(4100, expect.any(Function));

    await runtime.close();
    await runtime.close();
    expect(io.close).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(closeQueueMock).toHaveBeenCalledTimes(1);
    expect(closeRedisMock).toHaveBeenCalledTimes(1);
    expect(closeDatabaseMock).toHaveBeenCalledTimes(1);
  });
});
