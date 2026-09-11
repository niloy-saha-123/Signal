import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";

vi.mock("@/lib/redis-client", () => ({ redis: {}, cacheRedis: { del: vi.fn() } }));
vi.mock("@/queues/registry", () => ({ queues: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/agents/discovery/competitor-discovery", () => ({
  discoverCompetitor: vi.fn(() => {
    throw new Error("discoverCompetitor must never run inside a route");
  }),
}));

import { discoverCompetitor } from "@/agents/discovery/competitor-discovery";
import { createCompetitorRouter, type CompetitorRouterDeps } from "@/api/competitors";

const UUID = "11111111-1111-4111-8111-111111111111";

async function call(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function makeDeps(over: Partial<CompetitorRouterDeps> = {}): CompetitorRouterDeps {
  return {
    createCompetitor: vi.fn(async (input: any) => ({
      id: UUID,
      name: input.name,
      domain: input.domain,
      discovery_status: "pending",
    })) as any,
    getCompetitorById: vi.fn(async () => ({ id: UUID, discovery_status: "pending" })) as any,
    listCompetitors: vi.fn(async () => [{ id: UUID }]) as any,
    getCompetitorDiscoveryLog: vi.fn(async () => [{ field_name: "subreddits" }]) as any,
    getLatestSignalScores: vi.fn(async () => []) as any,
    getRecentPricingDiffs: vi.fn(async () => []) as any,
    createAgentRun: vi.fn(async () => ({ id: "run-1" })) as any,
    failRunIfRunning: vi.fn(async () => undefined) as any,
    enqueue: vi.fn(async () => undefined),
    isPublicHostname: vi.fn(async () => true),
    ...over,
  };
}

const app = (deps: CompetitorRouterDeps) => express().use("/api/competitors", createCompetitorRouter(deps));

beforeEach(() => vi.clearAllMocks());

describe("POST /api/competitors", () => {
  it("creates the row, enqueues discovery after commit, returns 201", async () => {
    const deps = makeDeps();
    const res = await call(app(deps), "POST", "/api/competitors", {
      name: "Acme",
      domain: "acme.com",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: UUID, discovery_status: "pending" });
    expect(deps.enqueue).toHaveBeenCalledWith("competitor-discovery", {
      competitor_id: UUID,
      name: "Acme",
      domain: "acme.com",
    });
    const createOrder = (deps.createCompetitor as any).mock.invocationCallOrder[0];
    const enqueueOrder = (deps.enqueue as any).mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(enqueueOrder);
    expect(discoverCompetitor).not.toHaveBeenCalled();
  });

  it("rejects an unknown body key with 400 validation", async () => {
    const deps = makeDeps();
    const res = await call(app(deps), "POST", "/api/competitors", {
      name: "Acme",
      domain: "acme.com",
      surprise: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation");
    expect(deps.createCompetitor).not.toHaveBeenCalled();
  });

  it("rejects a missing required field with 400", async () => {
    const res = await call(app(makeDeps()), "POST", "/api/competitors", { name: "Acme" });
    expect(res.status).toBe(400);
  });

  it("rejects an unbounded competitor name", async () => {
    const deps = makeDeps();
    const res = await call(app(deps), "POST", "/api/competitors", {
      name: "x".repeat(201),
      domain: "acme.com",
    });
    expect(res.status).toBe(400);
    expect(deps.createCompetitor).not.toHaveBeenCalled();
  });

  it("rejects a pricing_url whose host is not public with 400", async () => {
    const deps = makeDeps({ isPublicHostname: vi.fn(async () => false) });
    const res = await call(app(deps), "POST", "/api/competitors", {
      name: "Acme",
      domain: "acme.com",
      pricing_url: "http://localhost:3000/pricing",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/public URL/);
    expect(deps.createCompetitor).not.toHaveBeenCalled();
  });

  it.each([
    "ftp://example.com/pricing",
    "https://user:password@example.com/pricing",
    "https://example.com:8443/pricing",
  ])("rejects a non-HTTP, credentialed, or non-default override URL: %s", async (pricing_url) => {
    const deps = makeDeps();
    const res = await call(app(deps), "POST", "/api/competitors", {
      name: "Acme",
      domain: "acme.com",
      pricing_url,
    });
    expect(res.status).toBe(400);
    expect(deps.createCompetitor).not.toHaveBeenCalled();
  });

  it("returns 500 enqueue_failed with the id when the queue throws (row kept)", async () => {
    const deps = makeDeps({
      enqueue: vi.fn(async () => {
        throw new Error("redis down");
      }),
    });
    const res = await call(app(deps), "POST", "/api/competitors", {
      name: "Acme",
      domain: "acme.com",
    });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "enqueue_failed", competitor_id: UUID });
    expect(deps.createCompetitor).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/competitors", () => {
  it("lists competitors", async () => {
    const res = await call(app(makeDeps()), "GET", "/api/competitors");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: UUID }]);
  });
});

describe("GET /api/competitors/:id", () => {
  it("400 on a malformed uuid (not 404)", async () => {
    const res = await call(app(makeDeps()), "GET", "/api/competitors/not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("404 when the competitor is missing", async () => {
    const deps = makeDeps({ getCompetitorById: vi.fn(async () => undefined) as any });
    const res = await call(app(deps), "GET", `/api/competitors/${UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("200 with the row", async () => {
    const res = await call(app(makeDeps()), "GET", `/api/competitors/${UUID}`);
    expect(res.status).toBe(200);
  });

  it("500 { error: internal } when a query throws unexpectedly", async () => {
    const deps = makeDeps({
      getCompetitorById: vi.fn(async () => {
        throw new Error("pg exploded");
      }) as any,
    });
    const res = await call(app(deps), "GET", `/api/competitors/${UUID}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal" });
  });
});

describe("GET /api/competitors/:id/discovery", () => {
  it("200 with status + log", async () => {
    const res = await call(app(makeDeps()), "GET", `/api/competitors/${UUID}/discovery`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      discovery_status: "pending",
      log: [{ field_name: "subreddits" }],
    });
  });

  it("404 when competitor missing", async () => {
    const deps = makeDeps({ getCompetitorById: vi.fn(async () => undefined) as any });
    const res = await call(app(deps), "GET", `/api/competitors/${UUID}/discovery`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/competitors/:id/score", () => {
  it("404 no_score when no score computed", async () => {
    const res = await call(app(makeDeps()), "GET", `/api/competitors/${UUID}/score`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("no_score");
  });

  it("200 with score + components + deltas", async () => {
    const deps = makeDeps({
      getLatestSignalScores: vi.fn(async () => [
        {
          score: 72,
          components: { velocity: 1 },
          computed_at: new Date("2026-01-01T00:00:00.000Z"),
          delta_7d: 3.5,
          delta_30d: null,
        },
      ]) as any,
    });
    const res = await call(app(deps), "GET", `/api/competitors/${UUID}/score`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      score: 72,
      components: { velocity: 1 },
      computed_at: "2026-01-01T00:00:00.000Z",
      delta_7d: 3.5,
      delta_30d: null,
    });
  });
});

describe("POST /api/competitors/:id/analyze", () => {
  it("creates a run, enqueues analysis, returns 202", async () => {
    const deps = makeDeps({
      getRecentPricingDiffs: vi.fn(async () => [{ id: "d1" }]) as any,
    });
    const res = await call(app(deps), "POST", `/api/competitors/${UUID}/analyze`);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ run_id: "run-1", status: "running" });
    expect(deps.enqueue).toHaveBeenCalledWith("analysis", {
      competitor_id: UUID,
      run_id: "run-1",
      has_pricing_diff: true,
    });
  });

  it("404 when competitor missing (no run created)", async () => {
    const deps = makeDeps({ getCompetitorById: vi.fn(async () => undefined) as any });
    const res = await call(app(deps), "POST", `/api/competitors/${UUID}/analyze`);
    expect(res.status).toBe(404);
    expect(deps.createAgentRun).not.toHaveBeenCalled();
  });

  it("marks the run failed and returns 500 when enqueue throws", async () => {
    const deps = makeDeps({
      enqueue: vi.fn(async () => {
        throw new Error("redis down");
      }),
    });
    const res = await call(app(deps), "POST", `/api/competitors/${UUID}/analyze`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "enqueue_failed", run_id: "run-1" });
    expect(deps.failRunIfRunning).toHaveBeenCalledWith("run-1");
  });

  it("closes the run when pricing-diff lookup fails after run creation", async () => {
    const deps = makeDeps({
      getRecentPricingDiffs: vi.fn(async () => {
        throw new Error("postgres down");
      }) as any,
    });

    const res = await call(app(deps), "POST", `/api/competitors/${UUID}/analyze`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal", run_id: "run-1" });
    expect(deps.failRunIfRunning).toHaveBeenCalledWith("run-1");
    expect(deps.enqueue).not.toHaveBeenCalled();
  });
});
