import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";

vi.mock("@/lib/redis-client", () => ({ redis: {}, cacheRedis: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createActivityRouter, type ActivityRouterDeps } from "@/api/activity";

const WS_UUID = "22222222-2222-4222-8222-222222222222";
const USER_UUID = "33333333-3333-4333-8333-333333333333";

async function call(app: express.Express, path: string) {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function appWithUser(workspaceId: string | null, router: express.Router) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: USER_UUID, email: "test@example.com" };
    req.workspaceId = workspaceId;
    next();
  });
  app.use("/api/activity", router);
  return app;
}

function makeDeps(overrides: Partial<ActivityRouterDeps> = {}): ActivityRouterDeps {
  return {
    getWorkspaceActivity: vi.fn().mockResolvedValue({
      runs: [],
      spend_today_usd: 0,
      daily_budget_usd: 2,
      open_circuits: [],
    }),
    ...overrides,
  };
}

describe("GET /api/activity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns this workspace's runs, spend and circuit state", async () => {
    const getWorkspaceActivity = vi.fn().mockResolvedValue({
      runs: [
        {
          id: "r1",
          competitor_id: "c1",
          trigger: "scheduled",
          status: "completed",
          outcome: "alert",
          started_at: new Date("2026-09-25T00:00:00.000Z"),
          completed_at: new Date("2026-09-25T00:01:00.000Z"),
        },
      ],
      spend_today_usd: 0.42,
      daily_budget_usd: 2,
      open_circuits: ["openai"],
    });
    const app = appWithUser(WS_UUID, createActivityRouter(makeDeps({ getWorkspaceActivity })));

    const res = await call(app, "/api/activity");

    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.spend_today_usd).toBeCloseTo(0.42, 5);
    expect(res.body.open_circuits).toEqual(["openai"]);
  });

  it("scopes the query to the caller's workspace", async () => {
    // Latency and cost tables are not workspace-scoped by default. Anything
    // here must be filtered by workspace or it leaks another tenant's activity.
    const getWorkspaceActivity = vi.fn().mockResolvedValue({
      runs: [],
      spend_today_usd: 0,
      daily_budget_usd: 2,
      open_circuits: [],
    });
    const app = appWithUser(WS_UUID, createActivityRouter(makeDeps({ getWorkspaceActivity })));

    await call(app, "/api/activity");

    expect(getWorkspaceActivity).toHaveBeenCalledWith(WS_UUID);
  });

  it("rejects a caller with no workspace", async () => {
    const app = appWithUser(null, createActivityRouter(makeDeps()));

    const res = await call(app, "/api/activity");

    expect(res.status).toBe(403);
  });
});
