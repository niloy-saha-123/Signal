import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";

vi.mock("@/lib/redis-client", () => ({ redis: {}, cacheRedis: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createAlertRouter, type AlertRouterDeps } from "@/api/alerts";
import { decodeCursor } from "@/api/cursor";

const UUID = "11111111-1111-4111-8111-111111111111";
const USER_UUID = "33333333-3333-4333-8333-333333333333";
const WS_UUID = "22222222-2222-4222-8222-222222222222";

async function call(app: express.Express, path: string): Promise<{ status: number; body: any }> {
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

const rowId = (i: number) => `1111111${i}-1111-4111-8111-111111111111`;

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: rowId(i),
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n - i)),
  }));
}

// Stands in for requireAuth — real middleware verifies a JWT, this just sets
// req.user/req.workspaceId directly, matching what requireAuth would have set.
function appWithUser(user: { id: string; workspaceId: string | null }, router: express.Router) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: user.id, email: "test@example.com" };
    req.workspaceId = user.workspaceId;
    next();
  });
  app.use("/api/alerts", router);
  return app;
}

const app = (deps: AlertRouterDeps) =>
  appWithUser({ id: USER_UUID, workspaceId: WS_UUID }, createAlertRouter(deps));

beforeEach(() => vi.clearAllMocks());

describe("workspace guard", () => {
  it("403s with no_workspace when req.workspaceId is null", async () => {
    const deps: AlertRouterDeps = { listAlertFeed: vi.fn(async () => []) as any };
    const noWorkspaceApp = appWithUser(
      { id: USER_UUID, workspaceId: null },
      createAlertRouter(deps)
    );
    const res = await call(noWorkspaceApp, `/api/alerts?competitor_ids=${UUID}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "no_workspace" });
    expect(deps.listAlertFeed).not.toHaveBeenCalled();
  });
});

describe("GET /api/alerts", () => {
  it("short page → null next_cursor", async () => {
    const deps: AlertRouterDeps = { listAlertFeed: vi.fn(async () => rows(2)) as any };
    const res = await call(app(deps), `/api/alerts?competitor_ids=${UUID}&limit=10`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.next_cursor).toBeNull();
  });

  it("full page → next_cursor set and decodable", async () => {
    const deps: AlertRouterDeps = { listAlertFeed: vi.fn(async () => rows(4)) as any };
    const res = await call(app(deps), `/api/alerts?competitor_ids=${UUID}&limit=3`);
    expect(res.body.data).toHaveLength(3);
    expect(decodeCursor(res.body.next_cursor).id).toBe(rowId(2));
  });

  it("400 on garbage cursor", async () => {
    const deps: AlertRouterDeps = { listAlertFeed: vi.fn(async () => []) as any };
    const res = await call(app(deps), "/api/alerts?cursor=%%%");
    expect(res.status).toBe(400);
    expect(deps.listAlertFeed).not.toHaveBeenCalled();
  });

  it("400 on unknown query key", async () => {
    const deps: AlertRouterDeps = { listAlertFeed: vi.fn(async () => []) as any };
    const res = await call(app(deps), "/api/alerts?nope=1");
    expect(res.status).toBe(400);
  });

  it("passes competitor_ids through", async () => {
    const deps: AlertRouterDeps = { listAlertFeed: vi.fn(async () => []) as any };
    await call(app(deps), `/api/alerts?competitor_ids=${UUID}`);
    expect((deps.listAlertFeed as any).mock.calls[0][0]).toMatchObject({
      workspace_id: WS_UUID,
      competitor_ids: [UUID],
      limit: 50,
    });
  });

  it("400 when competitor_ids is omitted", async () => {
    const deps: AlertRouterDeps = { listAlertFeed: vi.fn(async () => []) as any };
    const res = await call(app(deps), "/api/alerts?limit=10");
    expect(res.status).toBe(400);
    expect(deps.listAlertFeed).not.toHaveBeenCalled();
  });
});
