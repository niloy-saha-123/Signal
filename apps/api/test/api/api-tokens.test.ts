import { describe, it, expect, vi } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";

import { createApiTokenRouter, MAX_ACTIVE_API_TOKENS, type ApiTokenRouterDeps } from "@/api/api-tokens";
import { hashApiToken } from "@/mcp/tokens";

const USER_UUID = "11111111-1111-4111-8111-111111111111";
const WS_UUID = "22222222-2222-4222-8222-222222222222";
const TOKEN_UUID = "33333333-3333-4333-8333-333333333333";

async function call(app: express.Express, method: string, path: string, body?: unknown) {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const row = {
  id: TOKEN_UUID,
  workspace_id: WS_UUID,
  created_by: USER_UUID,
  name: "Cursor",
  prefix: "sig_abcdefgh",
  last_used_at: null,
  revoked_at: null,
  created_at: new Date("2026-10-02T00:00:00Z"),
};

function makeDeps(over: Partial<ApiTokenRouterDeps> = {}): ApiTokenRouterDeps {
  return {
    listApiTokens: vi.fn(async () => [row]) as any,
    countActiveApiTokens: vi.fn(async () => 0) as any,
    createApiToken: vi.fn(async (input: any) => ({ ...row, name: input.name, prefix: input.prefix })) as any,
    revokeApiToken: vi.fn(async () => ({ ...row, revoked_at: new Date() })) as any,
    ...over,
  };
}

function app(deps: ApiTokenRouterDeps, workspaceId: string | null = WS_UUID) {
  const a = express();
  a.use((req, _res, next) => {
    req.user = { id: USER_UUID, email: "t@example.com" };
    req.workspaceId = workspaceId;
    next();
  });
  a.use("/api/api-tokens", createApiTokenRouter(deps));
  return a;
}

describe("api-tokens router", () => {
  it("403s without a workspace", async () => {
    const res = await call(app(makeDeps(), null), "GET", "/api/api-tokens");
    expect(res.status).toBe(403);
  });

  it("lists the workspace's tokens", async () => {
    const deps = makeDeps();
    const res = await call(app(deps), "GET", "/api/api-tokens");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).not.toHaveProperty("token_hash");
    expect(deps.listApiTokens).toHaveBeenCalledWith(WS_UUID);
  });

  it("creates a token, returns plaintext once, stores only its hash", async () => {
    const deps = makeDeps();
    const res = await call(app(deps), "POST", "/api/api-tokens", { name: "  Cursor  " });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body.token).toMatch(/^sig_[A-Za-z0-9_-]{43}$/);
    const input = (deps.createApiToken as any).mock.calls[0][0];
    expect(input).toMatchObject({ workspace_id: WS_UUID, created_by: USER_UUID, name: "Cursor" });
    expect(input.token_hash).toBe(hashApiToken(res.body.token));
    expect(input).not.toHaveProperty("token");
    expect(res.body.token.startsWith(input.prefix)).toBe(true);
  });

  it("rejects empty, long, and extra-field bodies", async () => {
    for (const body of [{ name: "" }, { name: "x".repeat(61) }, { name: "a", extra: 1 }, {}]) {
      const res = await call(app(makeDeps()), "POST", "/api/api-tokens", body);
      expect(res.status).toBe(400);
    }
  });

  it("409s at the active-token cap", async () => {
    const deps = makeDeps({ countActiveApiTokens: vi.fn(async () => MAX_ACTIVE_API_TOKENS) as any });
    const res = await call(app(deps), "POST", "/api/api-tokens", { name: "x" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "token_limit" });
    expect(deps.createApiToken).not.toHaveBeenCalled();
  });

  it("revokes scoped to the workspace", async () => {
    const deps = makeDeps();
    const res = await call(app(deps), "DELETE", `/api/api-tokens/${TOKEN_UUID}`);
    expect(res.status).toBe(204);
    expect(deps.revokeApiToken).toHaveBeenCalledWith(TOKEN_UUID, WS_UUID);
  });

  it("404s revoking an unknown or foreign token, 400s a bad id", async () => {
    const deps = makeDeps({ revokeApiToken: vi.fn(async () => null) as any });
    expect((await call(app(deps), "DELETE", `/api/api-tokens/${TOKEN_UUID}`)).status).toBe(404);
    expect((await call(app(deps), "DELETE", "/api/api-tokens/nope")).status).toBe(400);
  });
});
