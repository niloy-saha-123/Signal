import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import express from "express";

vi.mock("@/lib/redis-client", () => ({ redis: {}, cacheRedis: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createSlackRouter, prefillFromMessage, type SlackRouterDeps } from "@/api/slack";
import { signSlackState } from "@/integrations/slack/oauth";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const TEAM_ID = "T0000001";
const WS_UUID = "22222222-2222-4222-8222-222222222222";
const COMP_UUID = "11111111-1111-4111-8111-111111111111";

const RESULT = {
  team_id: TEAM_ID,
  team_name: "Acme",
  bot_token: "xoxb-new",
  bot_user_id: "U0BOT",
  channel_id: "C9",
  channel_name: "#intel",
};

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
    deleteSlackInstallationForTeam: vi.fn().mockResolvedValue(undefined),
    enqueueSlackQuestion: vi.fn().mockResolvedValue(undefined),
    commands: {
      listCompetitorsForWorkspace: vi.fn().mockResolvedValue([
        { id: COMP_UUID, name: "Acme", is_active: true },
        { id: "77777777-7777-4777-8777-777777777777", name: "Acme Cloud", is_active: true },
        { id: "88888888-8888-4888-8888-888888888888", name: "Globex", is_active: true },
        { id: "99999999-9999-4999-8999-999999999999", name: "Dormant", is_active: false },
      ]),
      getCompetitorByIdForWorkspace: vi.fn(async (id: string) =>
        id === COMP_UUID ? { id: COMP_UUID, name: "Acme" } : undefined
      ),
      listPredictionsForWorkspace: vi.fn().mockResolvedValue([
        { statement: "Acme ships SSO", probability: 0.7, resolves_at: new Date("2026-12-01T00:00:00Z") },
      ]),
      openView: vi.fn().mockResolvedValue(undefined),
      enqueueSlackIntel: vi.fn().mockResolvedValue(undefined),
    } as any,
    oauth: {
      config: () => ({ clientId: "1", clientSecret: "cs", redirectUri: "https://api.x/api/slack/oauth/callback" }),
      exchangeCode: vi.fn().mockResolvedValue(RESULT),
      savePendingInstall: vi.fn().mockResolvedValue("pending-id"),
      frontendUrl: "http://app.test",
    },
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


// body-parser sets req._body on the first parse and every later express.json()
// short-circuits on it. So a Slack router mounted BEHIND the app's global JSON
// parser never gets its `verify` hook called, never captures the raw bytes, and
// silently 401s every genuine Slack request. The bug is undiagnosable from the
// outside — a correct signature and a forged one both return 401.
function appWithGlobalJsonParser(router: express.Router) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/slack", router);
  return app;
}

describe("POST /api/slack/events raw-body capture", () => {
  beforeEach(() => vi.clearAllMocks());

  it("verifies a correctly signed request when mounted ahead of the JSON parser", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const app = appWith(createSlackRouter(makeDeps()));

    const res = await post(app, "/api/slack/events", body, signedHeaders(body));

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBe("abc123");
  });

  it("fails loudly, not silently, when mounted behind a body parser", async () => {
    // Misordered middleware is a deployment mistake, and it must not look like
    // a signature failure. A 401 here would send whoever debugs it hunting for
    // a wrong signing secret forever.
    const enqueueSlackQuestion = vi.fn();
    const body = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const app = appWithGlobalJsonParser(
      createSlackRouter(makeDeps({ enqueueSlackQuestion }))
    );

    const res = await post(app, "/api/slack/events", body, signedHeaders(body));

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("slack_raw_body_unavailable");
    expect(enqueueSlackQuestion).not.toHaveBeenCalled();
  });
});

describe("POST /api/slack/events resilience", () => {
  beforeEach(() => vi.clearAllMocks());

  it("acks instead of hanging when the installation lookup fails", async () => {
    // An unhandled rejection means no response at all. Slack waits 3s, gives
    // up, and redelivers — and each redelivery runs the agent again and posts
    // another answer into the same thread.
    const getSlackInstallation = vi.fn().mockRejectedValue(new Error("pool exhausted"));
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event: { type: "app_mention", text: "<@U0BOT> hi", channel: "C1", user: "U1", ts: "1.0" },
    });
    const app = appWith(createSlackRouter(makeDeps({ getSlackInstallation })));

    const res = await post(app, "/api/slack/events", body, signedHeaders(body));

    expect(res.status).toBe(200);
  });

  it("ignores a Slack retry delivery rather than answering twice", async () => {
    const enqueueSlackQuestion = vi.fn().mockResolvedValue(undefined);
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event: { type: "app_mention", text: "<@U0BOT> hi", channel: "C1", user: "U1", ts: "1.0" },
    });
    const app = appWith(createSlackRouter(makeDeps({ enqueueSlackQuestion })));

    const res = await post(app, "/api/slack/events", body, {
      ...signedHeaders(body),
      "x-slack-retry-num": "1",
    });

    expect(res.status).toBe(200);
    expect(enqueueSlackQuestion).not.toHaveBeenCalled();
  });

  it("carries a stable dedupe key derived from the event", async () => {
    // Second line of defence: even if a retry gets through, a deterministic job
    // id collapses the duplicate instead of running the agent twice.
    const enqueueSlackQuestion = vi.fn().mockResolvedValue(undefined);
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event: {
        type: "app_mention",
        text: "<@U0BOT> hi",
        channel: "C1",
        user: "U1",
        ts: "1700000000.000100",
      },
    });
    const app = appWith(createSlackRouter(makeDeps({ enqueueSlackQuestion })));

    await post(app, "/api/slack/events", body, signedHeaders(body));

    const [payload] = enqueueSlackQuestion.mock.calls[0];
    // BullMQ rejects custom job ids containing ":".
    expect(payload.dedupe_key).toBe(`${TEAM_ID}-1700000000.000100`);
  });
});

async function getRedirect(app: express.Express, path: string): Promise<{ status: number; location: string | null }> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" });
    return { status: res.status, location: res.headers.get("location") };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("GET /api/slack/oauth/callback", () => {
  const state = () => signSlackState({ workspace_id: WS_UUID, user_id: "user-1" }, "cs");

  it("parks the install and redirects with its id, writing nothing", async () => {
    const deps = makeDeps();
    const res = await getRedirect(appWith(createSlackRouter(deps)), `/api/slack/oauth/callback?code=abc&state=${state()}`);
    expect(res).toEqual({ status: 302, location: "http://app.test/settings?slack_install=pending-id" });
    expect(deps.oauth.exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ clientId: "1" }), "abc");
    expect(deps.oauth.savePendingInstall).toHaveBeenCalledWith({
      workspace_id: WS_UUID,
      user_id: "user-1",
      result: RESULT,
    });
  });

  it("reports a cancelled install without calling Slack", async () => {
    const deps = makeDeps();
    const res = await getRedirect(appWith(createSlackRouter(deps)), "/api/slack/oauth/callback?error=access_denied&state=x");
    expect(res.location).toBe("http://app.test/settings?slack=cancelled");
    expect(deps.oauth.exchangeCode).not.toHaveBeenCalled();
  });

  it.each([
    ["a forged state", "/api/slack/oauth/callback?code=abc&state=bad.sig"],
    ["no code", "/api/slack/oauth/callback?state=STATE"],
  ])("redirects with error on %s", async (_label, path) => {
    const deps = makeDeps();
    const res = await getRedirect(appWith(createSlackRouter(deps)), path.replace("STATE", state()));
    expect(res.location).toBe("http://app.test/settings?slack=error");
    expect(deps.oauth.savePendingInstall).not.toHaveBeenCalled();
  });

  it("redirects with error when the server has no Slack config", async () => {
    const deps = makeDeps();
    deps.oauth.config = () => null;
    const res = await getRedirect(appWith(createSlackRouter(deps)), `/api/slack/oauth/callback?code=abc&state=${state()}`);
    expect(res.location).toBe("http://app.test/settings?slack=error");
  });

  it("Slack ok:false leaves nothing parked", async () => {
    const deps = makeDeps();
    (deps.oauth.exchangeCode as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Slack oauth.v2.access failed: invalid_code"));
    const res = await getRedirect(appWith(createSlackRouter(deps)), `/api/slack/oauth/callback?code=abc&state=${state()}`);
    expect(res.location).toBe("http://app.test/settings?slack=error");
    expect(deps.oauth.savePendingInstall).not.toHaveBeenCalled();
  });
});

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function signedForm(app: express.Express, path: string, fields: Record<string, string>) {
  const body = form(fields);
  return post(app, path, body, { ...FORM, ...signedHeaders(body) });
}

function eventBody(event: Record<string, unknown>): string {
  return JSON.stringify({ type: "event_callback", team_id: TEAM_ID, event });
}

describe("POST /api/slack/events — DMs and uninstall", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers a DM inline, not in a thread", async () => {
    const deps = makeDeps();
    const body = eventBody({ type: "message", channel_type: "im", text: "what's new?", channel: "D1", user: "U1", ts: "5.0" });
    await post(appWith(createSlackRouter(deps)), "/api/slack/events", body, signedHeaders(body));
    expect(deps.enqueueSlackQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "D1", question: "what's new?", thread_ts: "" })
    );
  });

  it.each([
    ["a channel message", { type: "message", channel_type: "channel", text: "hi", channel: "C1", user: "U1", ts: "5.0" }],
    ["an edited DM", { type: "message", channel_type: "im", subtype: "message_changed", text: "hi", channel: "D1", user: "U1", ts: "5.0" }],
  ])("ignores %s", async (_label, event) => {
    const deps = makeDeps();
    const body = eventBody(event);
    const res = await post(appWith(createSlackRouter(deps)), "/api/slack/events", body, signedHeaders(body));
    expect(res.status).toBe(200);
    expect(deps.enqueueSlackQuestion).not.toHaveBeenCalled();
  });

  it.each([
    ["app_uninstalled", { type: "app_uninstalled" }],
    ["tokens_revoked for the bot", { type: "tokens_revoked", tokens: { bot: ["U0BOT"] } }],
  ])("removes the installation on %s", async (_label, event) => {
    const deps = makeDeps();
    const body = eventBody(event);
    const res = await post(appWith(createSlackRouter(deps)), "/api/slack/events", body, signedHeaders(body));
    expect(res.status).toBe(200);
    expect(deps.deleteSlackInstallationForTeam).toHaveBeenCalledWith(TEAM_ID);
  });

  it("keeps the installation when only user tokens were revoked", async () => {
    const deps = makeDeps();
    const body = eventBody({ type: "tokens_revoked", tokens: { oauth: ["U1"] } });
    await post(appWith(createSlackRouter(deps)), "/api/slack/events", body, signedHeaders(body));
    expect(deps.deleteSlackInstallationForTeam).not.toHaveBeenCalled();
  });
});

describe("POST /api/slack/commands", () => {
  beforeEach(() => vi.clearAllMocks());
  const base = {
    team_id: TEAM_ID,
    user_id: "U1",
    channel_id: "C1",
    response_url: "https://hooks.slack.com/commands/T1/1/abc",
    trigger_id: "trig.1",
    command: "/signal",
  };

  it("rejects an unsigned command", async () => {
    const deps = makeDeps();
    const res = await post(appWith(createSlackRouter(deps)), "/api/slack/commands", form({ ...base, text: "ask hi" }), FORM);
    expect(res.status).toBe(401);
    expect(deps.enqueueSlackQuestion).not.toHaveBeenCalled();
  });

  it("tells an unconnected team to connect, without doing work", async () => {
    const deps = makeDeps({ getSlackInstallation: vi.fn().mockResolvedValue(undefined) });
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/commands", { ...base, text: "ask hi" });
    expect(res.status).toBe(200);
    expect(res.body.text).toMatch(/isn't connected/);
    expect(deps.enqueueSlackQuestion).not.toHaveBeenCalled();
  });

  it("ask: queues the question with the response_url and acks privately", async () => {
    const deps = makeDeps();
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/commands", {
      ...base,
      text: "ask what is Acme planning?",
    });
    expect(res.body).toEqual({ response_type: "ephemeral", text: expect.stringMatching(/Looking into it/) });
    const [question] = (deps.enqueueSlackQuestion as any).mock.calls[0];
    expect(question).toMatchObject({
      workspace_id: WS_UUID,
      team_id: TEAM_ID,
      user: "U1",
      question: "what is Acme planning?",
      response_url: base.response_url,
    });
    expect(question.dedupe_key).not.toContain(":");
    expect(question).not.toHaveProperty("bot_token");
  });

  it("ask: refuses a response_url outside hooks.slack.com", async () => {
    const deps = makeDeps();
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/commands", {
      ...base,
      text: "ask hi",
      response_url: "https://evil.example/hook",
    });
    expect(res.status).toBe(400);
    expect(deps.enqueueSlackQuestion).not.toHaveBeenCalled();
  });

  it("ask with no question explains the syntax", async () => {
    const deps = makeDeps();
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/commands", { ...base, text: "ask" });
    expect(res.body.text).toMatch(/\/signal ask/);
    expect(deps.enqueueSlackQuestion).not.toHaveBeenCalled();
  });

  it("forecast: an exact name wins over a longer match and lists the soonest open forecasts", async () => {
    const deps = makeDeps();
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/commands", { ...base, text: "forecast acme" });
    expect(deps.commands.listPredictionsForWorkspace).toHaveBeenCalledWith({
      workspace_id: WS_UUID,
      competitor_id: COMP_UUID,
      status: "open",
      limit: 5,
      soonest_first: true,
    });
    expect(res.body.response_type).toBe("ephemeral");
    expect(JSON.stringify(res.body.blocks)).toContain("Acme ships SSO");
  });

  it("forecast: an ambiguous name lists active competitors only", async () => {
    const deps = makeDeps();
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/commands", { ...base, text: "forecast acm" });
    expect(res.body.text).toMatch(/No single competitor matches "acm"/);
    expect(res.body.text).toContain("Globex");
    expect(res.body.text).not.toContain("Dormant");
    expect(deps.commands.listPredictionsForWorkspace).not.toHaveBeenCalled();
  });

  it("intel: opens the modal with the link and note prefilled", async () => {
    const deps = makeDeps();
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/commands", {
      ...base,
      text: "intel <https://acme.dev/pricing> they raised prices",
    });
    expect(res.status).toBe(200);
    const [token, trigger, view] = (deps.commands.openView as any).mock.calls[0];
    expect(token).toBe("xoxb-test");
    expect(trigger).toBe("trig.1");
    const json = JSON.stringify(view);
    expect(json).toContain("https://acme.dev/pricing");
    expect(json).toContain("they raised prices");
    expect(json).not.toContain("Dormant");
  });

  it("intel: says so when the modal can't open", async () => {
    const deps = makeDeps();
    (deps.commands.openView as any).mockRejectedValue(new Error("expired_trigger_id"));
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/commands", { ...base, text: "intel" });
    expect(res.status).toBe(200);
    expect(res.body.text).toMatch(/Something went wrong/);
  });

  it.each(["", "help", "dance"])("shows usage for %j", async (text) => {
    const deps = makeDeps();
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/commands", { ...base, text });
    expect(res.body.text).toContain("/signal ask");
  });
});

describe("POST /api/slack/interactions", () => {
  beforeEach(() => vi.clearAllMocks());

  const submission = (values: Record<string, unknown>) => ({
    type: "view_submission",
    team: { id: TEAM_ID },
    user: { id: "U1" },
    view: { id: "V1", callback_id: "signal_intel", state: { values } },
  });
  const goodValues = {
    competitor: { value: { selected_option: { value: COMP_UUID } } },
    url: { value: { value: "https://acme.dev/blog/sso" } },
    note: { value: { value: "Sales heard SSO is coming" } },
  };

  it("rejects an unsigned interaction", async () => {
    const deps = makeDeps();
    const body = form({ payload: JSON.stringify(submission(goodValues)) });
    const res = await post(appWith(createSlackRouter(deps)), "/api/slack/interactions", body, FORM);
    expect(res.status).toBe(401);
    expect(deps.commands.enqueueSlackIntel).not.toHaveBeenCalled();
  });

  it("Send to Signal opens the modal prefilled from the message", async () => {
    const deps = makeDeps();
    await signedForm(appWith(createSlackRouter(deps)), "/api/slack/interactions", {
      payload: JSON.stringify({
        type: "message_action",
        callback_id: "send_to_signal",
        trigger_id: "trig.2",
        team: { id: TEAM_ID },
        user: { id: "U1" },
        message: { text: "<@U9> look: <https://acme.dev/changelog|Acme changelog> &amp; more" },
      }),
    });
    const [, trigger, view] = (deps.commands.openView as any).mock.calls[0];
    expect(trigger).toBe("trig.2");
    const json = JSON.stringify(view);
    expect(json).toContain('"initial_value":"https://acme.dev/changelog"');
    expect(json).toContain("look: Acme changelog & more");
  });

  it("a valid submission queues the intel and closes the modal", async () => {
    const deps = makeDeps();
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/interactions", {
      payload: JSON.stringify(submission(goodValues)),
    });
    expect(res.status).toBe(200);
    expect(res.raw).toBe("");
    const [intel] = (deps.commands.enqueueSlackIntel as any).mock.calls[0];
    expect(intel).toMatchObject({
      workspace_id: WS_UUID,
      team_id: TEAM_ID,
      user: "U1",
      competitor_id: COMP_UUID,
      note: "Sales heard SSO is coming",
      url: "https://acme.dev/blog/sso",
    });
    expect(intel.dedupe_key).not.toContain(":");
  });

  it("a competitor outside the workspace is a field error, not a write", async () => {
    const deps = makeDeps();
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/interactions", {
      payload: JSON.stringify(
        submission({ ...goodValues, competitor: { value: { selected_option: { value: "66666666-6666-4666-8666-666666666666" } } } })
      ),
    });
    expect(res.body).toEqual({ response_action: "errors", errors: { competitor: "Pick a competitor." } });
    expect(deps.commands.enqueueSlackIntel).not.toHaveBeenCalled();
  });

  it("a non-http link and an empty note are field errors", async () => {
    const deps = makeDeps();
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/interactions", {
      payload: JSON.stringify(
        submission({ ...goodValues, url: { value: { value: "javascript:alert(1)" } }, note: { value: { value: "  " } } })
      ),
    });
    expect(res.body.response_action).toBe("errors");
    expect(Object.keys(res.body.errors).sort()).toEqual(["note", "url"]);
    expect(deps.commands.enqueueSlackIntel).not.toHaveBeenCalled();
  });

  it("acks interaction types Signal doesn't use", async () => {
    const deps = makeDeps();
    const res = await signedForm(appWith(createSlackRouter(deps)), "/api/slack/interactions", {
      payload: JSON.stringify({ type: "block_actions", team: { id: TEAM_ID } }),
    });
    expect(res.status).toBe(200);
    expect(deps.commands.openView).not.toHaveBeenCalled();
  });
});

describe("prefillFromMessage", () => {
  it("takes the first link and keeps link labels in the note", () => {
    expect(prefillFromMessage("see <https://a.dev/x|this> and <https://b.dev>")).toEqual({
      url: "https://a.dev/x",
      note: "see this and https://b.dev",
    });
  });

  it("drops user and channel mentions", () => {
    expect(prefillFromMessage("<@U1> <#C1|general> hello")).toEqual({ url: undefined, note: "hello" });
  });

  it("returns nothing for an empty message", () => {
    expect(prefillFromMessage("")).toEqual({ url: undefined, note: undefined });
  });
});
