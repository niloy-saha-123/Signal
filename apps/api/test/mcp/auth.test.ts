import { describe, it, expect, vi } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";

import { requireApiToken, type ApiTokenAuthDeps } from "@/mcp/auth";
import { generateApiToken, hashApiToken } from "@/mcp/tokens";

const WS_UUID = "22222222-2222-4222-8222-222222222222";
const TOKEN_UUID = "33333333-3333-4333-8333-333333333333";

async function get(deps: ApiTokenAuthDeps, authorization?: string) {
  const app = express();
  app.use(requireApiToken(deps));
  app.get("/", (req, res) => res.json({ workspaceId: req.workspaceId, apiTokenId: req.apiTokenId }));
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: authorization ? { authorization } : undefined,
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function makeDeps(found: boolean): ApiTokenAuthDeps {
  return {
    findActiveApiTokenByHash: vi.fn(async () => (found ? { id: TOKEN_UUID, workspace_id: WS_UUID } : null)),
    touchApiTokenLastUsed: vi.fn(async () => undefined),
  };
}

describe("generateApiToken", () => {
  it("is sig_-prefixed, unique, and hashes deterministically", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.token).toMatch(/^sig_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashApiToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.prefix).toBe(a.token.slice(0, 12));
  });
});

describe("requireApiToken", () => {
  it("accepts an active token and scopes the request to its workspace", async () => {
    const { token } = generateApiToken();
    const deps = makeDeps(true);
    const res = await get(deps, `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ workspaceId: WS_UUID, apiTokenId: TOKEN_UUID });
    expect(deps.findActiveApiTokenByHash).toHaveBeenCalledWith(hashApiToken(token));
    expect(deps.touchApiTokenLastUsed).toHaveBeenCalledWith(TOKEN_UUID);
  });

  it("401s an unknown or revoked token with WWW-Authenticate", async () => {
    const res = await get(makeDeps(false), `Bearer ${generateApiToken().token}`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
  });

  it("401s a missing header, a non-sig token, or a malformed one without a DB lookup", async () => {
    const deps = makeDeps(true);
    for (const auth of [undefined, "Bearer eyJhbGciOi.jwt.token", "Bearer sig_short", "Basic abc"]) {
      expect((await get(deps, auth)).status).toBe(401);
    }
    expect(deps.findActiveApiTokenByHash).not.toHaveBeenCalled();
  });

  it("still serves the request when recording last_used_at fails", async () => {
    const deps = makeDeps(true);
    deps.touchApiTokenLastUsed = vi.fn(async () => {
      throw new Error("db down");
    });
    expect((await get(deps, `Bearer ${generateApiToken().token}`)).status).toBe(200);
  });

  it("accepts the Bearer scheme case-insensitively", async () => {
    expect((await get(makeDeps(true), `bearer ${generateApiToken().token}`)).status).toBe(200);
  });

  it("records last_used_at at most once a minute per token", async () => {
    const deps = makeDeps(true);
    const { token } = generateApiToken();
    // Fresh token id so earlier tests' touches do not count.
    deps.findActiveApiTokenByHash = vi.fn(async () => ({ id: "99999999-9999-4999-8999-999999999999", workspace_id: WS_UUID }));
    await get(deps, `Bearer ${token}`);
    await get(deps, `Bearer ${token}`);
    expect(deps.touchApiTokenLastUsed).toHaveBeenCalledTimes(1);
  });
});
