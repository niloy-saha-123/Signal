import { describe, it, expect, vi } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { createSlackIntegrationRouter, type SlackIntegrationRouterDeps } from "@/api/slack-integration";
import { verifySlackState } from "@/integrations/slack/oauth";

const WS = "22222222-2222-4222-8222-222222222222";
const CONFIG = { clientId: "1", clientSecret: "cs", redirectUri: "https://api.x/api/slack/oauth/callback" };

const ROW = {
  id: "r1",
  workspace_id: WS,
  team_id: "T1",
  team_name: "Acme",
  bot_token: "xoxb-secret",
  bot_user_id: "U",
  default_channel: "C1",
  default_channel_name: "#intel",
};

const PENDING = {
  workspace_id: WS,
  user_id: "user-1",
  result: {
    team_id: "T1",
    team_name: "Acme",
    bot_token: "xoxb-secret",
    bot_user_id: "U",
    channel_id: "C1",
    channel_name: "#intel",
  },
};

function makeDeps(overrides: Partial<SlackIntegrationRouterDeps> = {}): SlackIntegrationRouterDeps {
  return {
    config: () => CONFIG,
    getSlackInstallationForWorkspace: vi.fn().mockResolvedValue(undefined),
    deleteSlackInstallationsForWorkspace: vi.fn().mockResolvedValue(undefined),
    revokeToken: vi.fn().mockResolvedValue(undefined),
    takePendingInstall: vi.fn().mockResolvedValue(PENDING),
    replaceSlackInstallation: vi.fn().mockResolvedValue(ROW),
    ...overrides,
  };
}

function app(deps: SlackIntegrationRouterDeps, workspaceId: string | null = WS, userId = "user-1") {
  const a = express();
  a.use((req, _res, next) => {
    req.user = { id: userId, email: "a@b.c" };
    req.workspaceId = workspaceId;
    next();
  });
  a.use("/api/integrations/slack", createSlackIntegrationRouter(deps));
  return a;
}

async function call(a: express.Express, method: string, path: string, body?: unknown) {
  const server = a.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  } finally {
    server.close();
  }
}

describe("/api/integrations/slack", () => {
  it("403s without a workspace", async () => {
    expect((await call(app(makeDeps(), null), "GET", "/api/integrations/slack")).status).toBe(403);
  });

  it("reports not connected", async () => {
    const res = await call(app(makeDeps()), "GET", "/api/integrations/slack");
    expect(res).toMatchObject({ status: 200, body: { connected: false } });
  });

  it("reports the team and channel, never the token", async () => {
    const deps = makeDeps({ getSlackInstallationForWorkspace: vi.fn().mockResolvedValue(ROW) as any });
    const res = await call(app(deps), "GET", "/api/integrations/slack");
    expect(res.body).toEqual({ connected: true, team_name: "Acme", channel_name: "#intel" });
    expect(res.text).not.toContain("xoxb");
  });

  it("returns an authorize URL whose state names this workspace and user", async () => {
    const res = await call(app(makeDeps()), "POST", "/api/integrations/slack/install");
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.searchParams.get("scope")).toBe("app_mentions:read,chat:write,incoming-webhook");
    expect(verifySlackState(url.searchParams.get("state")!, "cs")).toMatchObject({ workspace_id: WS, user_id: "user-1" });
  });

  it("503s when Slack is not configured", async () => {
    const res = await call(app(makeDeps({ config: () => null })), "POST", "/api/integrations/slack/install");
    expect(res).toMatchObject({ status: 503, body: { error: "slack_not_configured" } });
  });

  it("disconnects even when Slack refuses the revoke", async () => {
    const deps = makeDeps({
      getSlackInstallationForWorkspace: vi.fn().mockResolvedValue(ROW) as any,
      revokeToken: vi.fn().mockRejectedValue(new Error("Slack auth.revoke failed: invalid_auth")),
    });
    const res = await call(app(deps), "DELETE", "/api/integrations/slack");
    expect(res.status).toBe(204);
    expect(deps.revokeToken).toHaveBeenCalledWith("xoxb-secret");
    expect(deps.deleteSlackInstallationsForWorkspace).toHaveBeenCalledWith(WS);
  });

  it("disconnect with nothing installed is still 204", async () => {
    const deps = makeDeps();
    expect((await call(app(deps), "DELETE", "/api/integrations/slack")).status).toBe(204);
    expect(deps.revokeToken).not.toHaveBeenCalled();
  });
});

describe("POST /api/integrations/slack/confirm", () => {
  const confirm = (deps: SlackIntegrationRouterDeps, ws: string | null = WS, user = "user-1", body: unknown = { install_id: "abc" }) =>
    call(app(deps, ws, user), "POST", "/api/integrations/slack/confirm", body);

  it("writes the installation and returns no token", async () => {
    const deps = makeDeps();
    const res = await confirm(deps);
    expect(res).toMatchObject({ status: 200, body: { connected: true, team_name: "Acme", channel_name: "#intel" } });
    expect(res.text).not.toContain("xoxb");
    expect(deps.takePendingInstall).toHaveBeenCalledWith("abc");
    expect(deps.replaceSlackInstallation).toHaveBeenCalledWith({
      workspace_id: WS,
      team_id: "T1",
      team_name: "Acme",
      bot_token: "xoxb-secret",
      bot_user_id: "U",
      default_channel: "C1",
      default_channel_name: "#intel",
      installed_by: "user-1",
    });
  });

  it("410s on a missing or expired id", async () => {
    const deps = makeDeps({ takePendingInstall: vi.fn().mockResolvedValue(null) });
    expect(await confirm(deps)).toMatchObject({ status: 410, body: { error: "install_expired" } });
    expect((await confirm(makeDeps(), WS, "user-1", {})).status).toBe(410);
    expect(deps.replaceSlackInstallation).not.toHaveBeenCalled();
  });

  it("403s for another workspace and does not write", async () => {
    const deps = makeDeps();
    const res = await confirm(deps, "33333333-3333-4333-8333-333333333333");
    expect(res).toMatchObject({ status: 403, body: { error: "install_mismatch" } });
    expect(deps.replaceSlackInstallation).not.toHaveBeenCalled();
  });

  it("403s for another user in the same workspace", async () => {
    const deps = makeDeps();
    expect((await confirm(deps, WS, "user-2")).status).toBe(403);
    expect(deps.replaceSlackInstallation).not.toHaveBeenCalled();
  });

  it("409s when the team belongs to another workspace", async () => {
    const deps = makeDeps({ replaceSlackInstallation: vi.fn().mockResolvedValue(null) });
    expect(await confirm(deps)).toMatchObject({ status: 409, body: { error: "team_in_use" } });
  });
});
