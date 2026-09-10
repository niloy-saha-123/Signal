import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";

vi.mock("../lib/redis-client", () => ({ redis: {}, cacheRedis: { del: vi.fn() } }));
vi.mock("../queues/registry", () => ({ queues: {} }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createCompanyProfileRouter, type CompanyProfileRouterDeps } from "./company-profile";

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

const VALID_BODY = { product_description: "A competitive-intel tool" };
const COMPETITOR_ID = "11111111-1111-4111-8111-111111111111";

function makeDeps(over: Partial<CompanyProfileRouterDeps> = {}): CompanyProfileRouterDeps {
  return {
    getCompanyProfile: vi.fn(async () => null) as any,
    getCompetitorsByIds: vi.fn(async (ids: string[]) => ids.map((id) => ({ id }))) as any,
    upsertCompanyProfile: vi.fn(async (input: any) => ({ id: "p1", ...input })) as any,
    invalidateProfileCache: vi.fn(async () => 1),
    enqueue: vi.fn(async () => undefined),
    ...over,
  };
}

const app = (deps: CompanyProfileRouterDeps) =>
  express().use("/api/company-profile", createCompanyProfileRouter(deps));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/company-profile", () => {
  it("404 with a clear message when absent", async () => {
    const res = await call(app(makeDeps()), "GET", "/api/company-profile");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      message: "No company profile configured. POST to create one.",
    });
  });

  it("200 with the row when present", async () => {
    const deps = makeDeps({ getCompanyProfile: vi.fn(async () => ({ id: "p1" })) as any });
    const res = await call(app(deps), "GET", "/api/company-profile");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "p1" });
  });
});

describe("POST /api/company-profile", () => {
  it("persists, invalidates cache, enqueues update, returns 200 with saved", async () => {
    const deps = makeDeps();
    const res = await call(app(deps), "POST", "/api/company-profile", VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "p1", product_description: VALID_BODY.product_description });
    expect(deps.upsertCompanyProfile).toHaveBeenCalledTimes(1);
    expect(deps.invalidateProfileCache).toHaveBeenCalledTimes(1);
    expect(deps.enqueue).toHaveBeenCalledWith("company-profile-update", {});
  });

  it("400 on an unknown body key", async () => {
    const deps = makeDeps();
    const res = await call(app(deps), "POST", "/api/company-profile", {
      ...VALID_BODY,
      extra: 1,
    });
    expect(res.status).toBe(400);
    expect(deps.upsertCompanyProfile).not.toHaveBeenCalled();
  });

  it("400 when required product_description is missing", async () => {
    const res = await call(app(makeDeps()), "POST", "/api/company-profile", { icp_company_size: "SMB" });
    expect(res.status).toBe(400);
  });

  it("400 when prompt-bearing profile text exceeds its semantic bound", async () => {
    const deps = makeDeps();
    const res = await call(app(deps), "POST", "/api/company-profile", {
      product_description: "x".repeat(10_001),
    });
    expect(res.status).toBe(400);
    expect(deps.upsertCompanyProfile).not.toHaveBeenCalled();
  });

  it("rejects unknown primary competitor ids before persisting", async () => {
    const deps = makeDeps({ getCompetitorsByIds: vi.fn(async () => []) as any });
    const res = await call(app(deps), "POST", "/api/company-profile", {
      ...VALID_BODY,
      primary_competitor_ids: [COMPETITOR_ID],
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "unknown_primary_competitor",
      missing: [COMPETITOR_ID],
    });
    expect(deps.upsertCompanyProfile).not.toHaveBeenCalled();
  });

  it("still 200 when the cache invalidation throws", async () => {
    const deps = makeDeps({
      invalidateProfileCache: vi.fn(async () => {
        throw new Error("redis down");
      }),
    });
    const res = await call(app(deps), "POST", "/api/company-profile", VALID_BODY);
    expect(res.status).toBe(200);
  });

  it("still 200 when the enqueue throws", async () => {
    const deps = makeDeps({
      enqueue: vi.fn(async () => {
        throw new Error("redis down");
      }),
    });
    const res = await call(app(deps), "POST", "/api/company-profile", VALID_BODY);
    expect(res.status).toBe(200);
    expect(deps.upsertCompanyProfile).toHaveBeenCalledTimes(1);
  });
});
