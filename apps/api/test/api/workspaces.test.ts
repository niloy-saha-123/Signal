import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";

import { createWorkspaceRouter, type WorkspaceRouterDeps } from "@/api/workspaces";

const USER_UUID = "11111111-1111-4111-8111-111111111111";
const WS_UUID = "22222222-2222-4222-8222-222222222222";

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

function makeDeps(over: Partial<WorkspaceRouterDeps> = {}): WorkspaceRouterDeps {
  return {
    createWorkspace: vi.fn(async (input: any) => ({
      id: WS_UUID,
      name: input.name,
      owner_id: input.ownerId,
    })) as any,
    getWorkspaceById: vi.fn(async (id: any) => ({
      id,
      name: "Acme",
      owner_id: USER_UUID,
    })) as any,
    renameWorkspace: vi.fn(async (id: any, name: any) => ({
      id,
      name,
      owner_id: USER_UUID,
    })) as any,
    ...over,
  };
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
  app.use("/", router);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/workspaces", () => {
  it("creates a workspace and returns it when the caller has none yet", async () => {
    const deps = makeDeps();
    const app = appWithUser({ id: USER_UUID, workspaceId: null }, createWorkspaceRouter(deps));
    const res = await call(app, "POST", "/", { name: "Acme" });
    expect(res.status).toBe(201);
    expect(deps.createWorkspace).toHaveBeenCalledWith({ name: "Acme", ownerId: USER_UUID });
  });

  it("409s if the caller already has a workspace", async () => {
    const app = appWithUser({ id: USER_UUID, workspaceId: WS_UUID }, createWorkspaceRouter(makeDeps()));
    const res = await call(app, "POST", "/", { name: "Acme" });
    expect(res.status).toBe(409);
  });

  it("rejects an unknown body key with 400 validation", async () => {
    const deps = makeDeps();
    const app = appWithUser({ id: USER_UUID, workspaceId: null }, createWorkspaceRouter(deps));
    const res = await call(app, "POST", "/", { name: "Acme", surprise: true });
    expect(res.status).toBe(400);
    expect(deps.createWorkspace).not.toHaveBeenCalled();
  });

  it("rejects a missing name with 400", async () => {
    const app = appWithUser({ id: USER_UUID, workspaceId: null }, createWorkspaceRouter(makeDeps()));
    const res = await call(app, "POST", "/", {});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/workspaces", () => {
  it("returns the caller's current workspace", async () => {
    const app = appWithUser({ id: USER_UUID, workspaceId: WS_UUID }, createWorkspaceRouter(makeDeps()));
    const res = await call(app, "GET", "/");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Acme");
  });

  it("403s with no workspace", async () => {
    const app = appWithUser({ id: USER_UUID, workspaceId: null }, createWorkspaceRouter(makeDeps()));
    const res = await call(app, "GET", "/");
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/workspaces", () => {
  it("renames the caller's workspace", async () => {
    const deps = makeDeps();
    const app = appWithUser({ id: USER_UUID, workspaceId: WS_UUID }, createWorkspaceRouter(deps));
    const res = await call(app, "PATCH", "/", { name: "Acme Inc." });
    expect(res.status).toBe(200);
    expect(deps.renameWorkspace).toHaveBeenCalledWith(WS_UUID, "Acme Inc.");
  });

  it("rejects an empty name with 400", async () => {
    const app = appWithUser({ id: USER_UUID, workspaceId: WS_UUID }, createWorkspaceRouter(makeDeps()));
    const res = await call(app, "PATCH", "/", { name: "" });
    expect(res.status).toBe(400);
  });

  it("403s with no workspace", async () => {
    const app = appWithUser({ id: USER_UUID, workspaceId: null }, createWorkspaceRouter(makeDeps()));
    const res = await call(app, "PATCH", "/", { name: "Acme" });
    expect(res.status).toBe(403);
  });
});
