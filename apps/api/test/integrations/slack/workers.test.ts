import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/redis-client", () => ({ redis: {}, cacheRedis: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/queues/registry", () => ({ registerWorker: vi.fn(), queues: {} }));
vi.mock("@/agents/chat/chat-agent", () => ({ runChatAgent: vi.fn() }));

import { slackQuestionProcessor, type SlackQuestionDeps } from "@/integrations/slack/slack-worker";
import { slackIntelProcessor, type SlackIntelDeps } from "@/integrations/slack/intel-worker";

const WS = "22222222-2222-4222-8222-222222222222";
const COMP = "11111111-1111-4111-8111-111111111111";
const installation = { team_id: "T1", workspace_id: WS, bot_token: "xoxb-1", bot_user_id: "UBOT" };
const job = <T>(data: T) => ({ data }) as any;

function questionDeps(over: Partial<SlackQuestionDeps> = {}): SlackQuestionDeps {
  return {
    getSlackInstallation: vi.fn().mockResolvedValue(installation),
    listCompetitorsForWorkspace: vi.fn().mockResolvedValue([{ id: COMP, is_active: true }]),
    createAgentRun: vi.fn().mockResolvedValue({ id: "run-1" }),
    completeAgentRun: vi.fn().mockResolvedValue(undefined),
    failRunIfRunning: vi.fn().mockResolvedValue(undefined),
    runChatAgent: vi.fn().mockResolvedValue({ refused: false, answer: "Acme is hiring <!channel> SREs", citations: [] }),
    postMessage: vi.fn().mockResolvedValue(undefined),
    postToResponseUrl: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as SlackQuestionDeps;
}

const question = {
  workspace_id: WS,
  team_id: "T1",
  channel: "C1",
  user: "U1",
  question: "what is <Acme> doing?",
  thread_ts: "1.0",
  dedupe_key: "T1-1.0",
};

describe("slackQuestionProcessor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("looks up the bot token by team and replies in the thread, read-only, escaped", async () => {
    const deps = questionDeps();
    await slackQuestionProcessor(job(question), deps);
    expect(deps.getSlackInstallation).toHaveBeenCalledWith("T1");
    expect(deps.runChatAgent).toHaveBeenCalledWith(expect.objectContaining({ read_only: true, workspace_id: WS }));
    const [msg] = (deps.postMessage as any).mock.calls[0];
    expect(msg).toMatchObject({ token: "xoxb-1", channel: "C1", thread_ts: "1.0" });
    expect(JSON.stringify(msg.blocks)).toContain("&lt;!channel&gt;");
    expect(deps.postToResponseUrl).not.toHaveBeenCalled();
  });

  it("answers /signal ask in the channel through response_url, echoing the escaped question", async () => {
    const deps = questionDeps();
    await slackQuestionProcessor(job({ ...question, response_url: "https://hooks.slack.com/x" }), deps);
    const [url, message] = (deps.postToResponseUrl as any).mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/x");
    expect(message.response_type).toBe("in_channel");
    expect(JSON.stringify(message.blocks)).toContain("<@U1> asked: what is &lt;Acme&gt; doing?");
    expect(deps.postMessage).not.toHaveBeenCalled();
  });

  it("drops a question whose team is no longer connected to that workspace", async () => {
    const deps = questionDeps({
      getSlackInstallation: vi.fn().mockResolvedValue({ ...installation, workspace_id: "other" }),
    });
    await slackQuestionProcessor(job(question), deps);
    expect(deps.runChatAgent).not.toHaveBeenCalled();
    expect(deps.postMessage).not.toHaveBeenCalled();
  });

  it("fails the run and says so when the agent throws", async () => {
    const deps = questionDeps({ runChatAgent: vi.fn().mockRejectedValue(new Error("boom")) });
    await slackQuestionProcessor(job(question), deps);
    expect(deps.failRunIfRunning).toHaveBeenCalledWith("run-1");
    expect(JSON.stringify((deps.postMessage as any).mock.calls[0][0].blocks)).toContain("Something went wrong");
  });
});

function intelDeps(over: Partial<SlackIntelDeps> = {}): SlackIntelDeps {
  return {
    getSlackInstallation: vi.fn().mockResolvedValue(installation),
    getCompetitorByIdForWorkspace: vi.fn().mockResolvedValue({ id: COMP, name: "Acme" }),
    fieldIntel: {
      consumeBudget: vi.fn().mockResolvedValue(undefined),
      signalExistsBySourceUrl: vi.fn().mockResolvedValue(false),
      fetchPublicPageText: vi.fn().mockResolvedValue("page text"),
      createSignal: vi.fn().mockResolvedValue({ id: "sig-1" }),
      enqueueInitialSignalPipeline: vi.fn().mockResolvedValue(undefined),
    },
    postMessage: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as SlackIntelDeps;
}

const intel = {
  workspace_id: WS,
  team_id: "T1",
  user: "U1",
  competitor_id: COMP,
  note: "Sales heard SSO is coming",
  url: "https://acme.dev/sso",
  dedupe_key: "T1-view-V1",
};

const dmText = (deps: SlackIntelDeps) => (deps.postMessage as any).mock.calls[0][0];

describe("slackIntelProcessor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves a field signal attributed to the Slack user and DMs them", async () => {
    const deps = intelDeps();
    await slackIntelProcessor(job(intel), deps);
    expect(deps.getCompetitorByIdForWorkspace).toHaveBeenCalledWith(COMP, WS);
    expect(deps.fieldIntel.createSignal).toHaveBeenCalledWith(
      expect.objectContaining({ competitor_id: COMP, source: "field", submitted_by: "slack:T1:U1" })
    );
    expect(dmText(deps)).toMatchObject({ token: "xoxb-1", channel: "U1", fallbackText: expect.stringContaining("Saved to *Acme*") });
  });

  it("tells the user when the link was a duplicate", async () => {
    const deps = intelDeps();
    (deps.fieldIntel.signalExistsBySourceUrl as any).mockResolvedValue(true);
    await slackIntelProcessor(job(intel), deps);
    expect(deps.fieldIntel.createSignal).not.toHaveBeenCalled();
    expect(dmText(deps).fallbackText).toMatch(/already has that link/);
  });

  it("tells the user when rate-limited", async () => {
    const deps = intelDeps();
    (deps.fieldIntel.consumeBudget as any).mockRejectedValue(new Error("budget"));
    await slackIntelProcessor(job(intel), deps);
    expect(dmText(deps).fallbackText).toMatch(/Too many/);
  });

  it("notes when the link couldn't be read", async () => {
    const deps = intelDeps();
    (deps.fieldIntel.fetchPublicPageText as any).mockRejectedValue(new Error("private host"));
    await slackIntelProcessor(job(intel), deps);
    expect(dmText(deps).fallbackText).toMatch(/only your note was kept/);
  });

  it("won't file under a competitor that left the workspace", async () => {
    const deps = intelDeps({ getCompetitorByIdForWorkspace: vi.fn().mockResolvedValue(undefined) });
    await slackIntelProcessor(job(intel), deps);
    expect(deps.fieldIntel.createSignal).not.toHaveBeenCalled();
    expect(dmText(deps).fallbackText).toMatch(/no longer in Signal/);
  });

  it("drops intel whose team was disconnected", async () => {
    const deps = intelDeps({ getSlackInstallation: vi.fn().mockResolvedValue(undefined) });
    await slackIntelProcessor(job(intel), deps);
    expect(deps.postMessage).not.toHaveBeenCalled();
    expect(deps.fieldIntel.createSignal).not.toHaveBeenCalled();
  });
});
