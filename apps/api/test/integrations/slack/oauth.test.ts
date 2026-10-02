import { describe, it, expect, vi, beforeEach } from "vitest";

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: safeFetchMock }));

import {
  buildSlackAuthorizeUrl,
  exchangeSlackCode,
  revokeSlackToken,
  signSlackState,
  slackOAuthConfig,
  verifySlackState,
} from "@/integrations/slack/oauth";

const SECRET = "client-secret";
const CONFIG = {
  clientId: "123.456",
  clientSecret: SECRET,
  redirectUri: "https://api.x/api/slack/oauth/callback",
};
const NOW = 1_800_000_000_000;

function slackResponse(body: unknown, status = 200) {
  return {
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("slack oauth state", () => {
  it("round-trips workspace and user", () => {
    const state = signSlackState(
      { workspace_id: "w1", user_id: "u1" },
      SECRET,
      NOW,
    );
    expect(verifySlackState(state, SECRET, NOW + 1000)).toEqual({
      workspace_id: "w1",
      user_id: "u1",
      exp: NOW + 600_000,
    });
  });

  it("rejects an expired state", () => {
    const state = signSlackState(
      { workspace_id: "w1", user_id: "u1" },
      SECRET,
      NOW,
    );
    expect(verifySlackState(state, SECRET, NOW + 600_001)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const state = signSlackState(
      { workspace_id: "w1", user_id: "u1" },
      SECRET,
      NOW,
    );
    const [, sig] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ workspace_id: "w2", user_id: "u1", exp: NOW + 600_000 }),
    ).toString("base64url");
    expect(verifySlackState(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a different secret, a short signature and malformed input", () => {
    const state = signSlackState(
      { workspace_id: "w1", user_id: "u1" },
      SECRET,
      NOW,
    );
    expect(verifySlackState(state, "other", NOW)).toBeNull();
    expect(
      verifySlackState(`${state.split(".")[0]}.abc`, SECRET, NOW),
    ).toBeNull();
    expect(verifySlackState("garbage", SECRET, NOW)).toBeNull();
    expect(verifySlackState("a.b.c", SECRET, NOW)).toBeNull();
  });
});

describe("slack oauth config and URL", () => {
  it("is null unless client id, secret and API_PUBLIC_URL are all set", () => {
    expect(
      slackOAuthConfig({ SLACK_CLIENT_ID: "1", SLACK_CLIENT_SECRET: "2" }),
    ).toBeNull();
    expect(
      slackOAuthConfig({
        SLACK_CLIENT_ID: "1",
        SLACK_CLIENT_SECRET: "2",
        API_PUBLIC_URL: "https://api.x/",
      }),
    ).toEqual({
      clientId: "1",
      clientSecret: "2",
      redirectUri: "https://api.x/api/slack/oauth/callback",
    });
  });

  it("builds the authorize URL with scopes, redirect and state", () => {
    const url = new URL(buildSlackAuthorizeUrl(CONFIG, "st"));
    expect(url.origin + url.pathname).toBe(
      "https://slack.com/oauth/v2/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("123.456");
    expect(url.searchParams.get("scope")).toBe(
      "app_mentions:read,chat:write,incoming-webhook",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get("state")).toBe("st");
  });
});

describe("exchangeSlackCode", () => {
  beforeEach(() => safeFetchMock.mockReset());

  it("returns the installation fields", async () => {
    safeFetchMock.mockResolvedValue(
      slackResponse({
        ok: true,
        access_token: "xoxb-1",
        bot_user_id: "UBOT",
        team: { id: "T1", name: "Acme" },
        incoming_webhook: { channel_id: "C1", channel: "#general" },
      }),
    );
    await expect(exchangeSlackCode(CONFIG, "code-1")).resolves.toEqual({
      team_id: "T1",
      team_name: "Acme",
      bot_token: "xoxb-1",
      bot_user_id: "UBOT",
      channel_id: "C1",
      channel_name: "#general",
    });
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe("https://slack.com/api/oauth.v2.access");
    expect(String(init.body)).toContain("code=code-1");
    expect(String(init.body)).toContain("client_secret=client-secret");
  });

  it("throws Slack's error code on ok:false, without echoing secrets", async () => {
    safeFetchMock.mockResolvedValue(
      slackResponse({ ok: false, error: "invalid_code" }),
    );
    await expect(exchangeSlackCode(CONFIG, "c")).rejects.toThrow(
      /invalid_code/,
    );
  });

  it("throws when the incoming webhook channel is missing", async () => {
    safeFetchMock.mockResolvedValue(
      slackResponse({
        ok: true,
        access_token: "x",
        bot_user_id: "U",
        team: { id: "T" },
      }),
    );
    await expect(exchangeSlackCode(CONFIG, "c")).rejects.toThrow(/missing/);
  });
});

describe("revokeSlackToken", () => {
  it("posts auth.revoke with the bearer token and throws on ok:false", async () => {
    safeFetchMock.mockResolvedValueOnce(
      slackResponse({ ok: true, revoked: true }),
    );
    await revokeSlackToken("xoxb-1");
    expect(safeFetchMock.mock.calls[0][0]).toBe(
      "https://slack.com/api/auth.revoke",
    );
    expect(safeFetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer xoxb-1",
    );
    safeFetchMock.mockResolvedValueOnce(
      slackResponse({ ok: false, error: "invalid_auth" }),
    );
    await expect(revokeSlackToken("x")).rejects.toThrow(/invalid_auth/);
  });
});
