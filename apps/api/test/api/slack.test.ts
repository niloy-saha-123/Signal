import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import express from "express";

vi.mock("@/lib/redis-client", () => ({ redis: {}, cacheRedis: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createSlackRouter, type SlackRouterDeps } from "@/api/slack";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const TEAM_ID = "T0000001";
const WS_UUID = "22222222-2222-4222-8222-222222222222";

function sign(body: string, timestamp: string): string {
  return `v0=${crypto
    .createHmac("sha256", SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
}

function makeDeps(overrides: Partial<SlackRouterDeps> = {}): SlackRouterDeps {
  return {
    signingSecret: SECRET,
    getSlackInstallation: vi.fn().mockResolvedValue({
      team_id: TEAM_ID,
      workspace_id: WS_UUID,
      bot_token: "xoxb-test",
      bot_user_id: "U0BOT",
    }),
    enqueueSlackQuestion: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function appWith(router: express.Router) {
  const app = express();
  app.use("/api/slack", router);
  return app;
}

async function post(
  app: express.Express,
  path: string,
  body: string,
  headers: Record<string, string>
): Promise<{ status: number; body: any; raw: string }> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
    const raw = await res.text();
    let parsed: any;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    return { status: res.status, body: parsed, raw };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function signedHeaders(body: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  return { "x-slack-request-timestamp": ts, "x-slack-signature": sign(body, ts) };
}

describe("POST /api/slack/events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("echoes Slack's URL verification challenge", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const app = appWith(createSlackRouter(makeDeps()));

    const res = await post(app, "/api/slack/events", body, signedHeaders(body));

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBe("abc123");
  });

  it("rejects an unsigned request and does no agent work", async () => {
    const enqueueSlackQuestion = vi.fn();
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event: { type: "app_mention", text: "<@U0BOT> what changed?", channel: "C1", user: "U1", ts: "1.0" },
    });
    const app = appWith(createSlackRouter(makeDeps({ enqueueSlackQuestion })));

    const res = await post(app, "/api/slack/events", body, {});

    expect(res.status).toBe(401);
    expect(enqueueSlackQuestion).not.toHaveBeenCalled();
  });

  it("rejects a tampered body carrying a valid signature for different content", async () => {
    const original = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const headers = signedHeaders(original);
    const tampered = JSON.stringify({ type: "url_verification", challenge: "hijacked" });
    const app = appWith(createSlackRouter(makeDeps()));

    const res = await post(app, "/api/slack/events", tampered, headers);

    expect(res.status).toBe(401);
  });

  it("rejects an event from a team with no installation", async () => {
    // An unknown team_id is an unmapped Slack workspace. Serving it would run an
    // agent against somebody else's data, or none at all.
    const getSlackInstallation = vi.fn().mockResolvedValue(undefined);
    const enqueueSlackQuestion = vi.fn();
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T_UNKNOWN",
      event: { type: "app_mention", text: "<@U0BOT> hi", channel: "C1", user: "U1", ts: "1.0" },
    });
    const app = appWith(createSlackRouter(makeDeps({ getSlackInstallation, enqueueSlackQuestion })));

    const res = await post(app, "/api/slack/events", body, signedHeaders(body));

    expect(res.status).toBe(401);
    expect(enqueueSlackQuestion).not.toHaveBeenCalled();
  });

  it("acks a mention immediately and runs the agent out of band", async () => {
    // Slack retries anything slower than 3 seconds, and a chat-agent turn is
    // routinely slower than that. A synchronous answer here would double-post.
    const enqueueSlackQuestion = vi.fn().mockResolvedValue(undefined);
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event: {
        type: "app_mention",
        text: "<@U0BOT> what did Acme ship?",
        channel: "C1",
        user: "U1",
        ts: "1700000000.000100",
      },
    });
    const app = appWith(createSlackRouter(makeDeps({ enqueueSlackQuestion })));

    const res = await post(app, "/api/slack/events", body, signedHeaders(body));

    expect(res.status).toBe(200);
    expect(enqueueSlackQuestion).toHaveBeenCalledTimes(1);
    const [payload] = enqueueSlackQuestion.mock.calls[0];
    expect(payload.workspace_id).toBe(WS_UUID);
    expect(payload.channel).toBe("C1");
    // The bot's own mention token is stripped — it is addressing, not question.
    expect(payload.question).toBe("what did Acme ship?");
  });

  it("ignores its own bot messages so it cannot answer itself", async () => {
    const enqueueSlackQuestion = vi.fn();
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event: {
        type: "app_mention",
        text: "<@U0BOT> hello",
        channel: "C1",
        user: "U0BOT",
        bot_id: "B0BOT",
        ts: "1.0",
      },
    });
    const app = appWith(createSlackRouter(makeDeps({ enqueueSlackQuestion })));

    const res = await post(app, "/api/slack/events", body, signedHeaders(body));

    expect(res.status).toBe(200);
    expect(enqueueSlackQuestion).not.toHaveBeenCalled();
  });

  it("answers in the thread the question was asked in", async () => {
    const enqueueSlackQuestion = vi.fn().mockResolvedValue(undefined);
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event: {
        type: "app_mention",
        text: "<@U0BOT> follow up",
        channel: "C1",
        user: "U1",
        ts: "1700000000.000200",
        thread_ts: "1700000000.000100",
      },
    });
    const app = appWith(createSlackRouter(makeDeps({ enqueueSlackQuestion })));

    await post(app, "/api/slack/events", body, signedHeaders(body));

    const [payload] = enqueueSlackQuestion.mock.calls[0];
    expect(payload.thread_ts).toBe("1700000000.000100");
  });

  it("still acks when enqueueing fails, so Slack does not retry into a loop", async () => {
    const enqueueSlackQuestion = vi.fn().mockRejectedValue(new Error("redis down"));
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event: { type: "app_mention", text: "<@U0BOT> hi", channel: "C1", user: "U1", ts: "1.0" },
    });
    const app = appWith(createSlackRouter(makeDeps({ enqueueSlackQuestion })));

    const res = await post(app, "/api/slack/events", body, signedHeaders(body));

    expect(res.status).toBe(200);
  });
});
