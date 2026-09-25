import { describe, it, expect, vi, beforeEach } from "vitest";

const { postMessageMock } = vi.hoisted(() => ({ postMessageMock: vi.fn() }));
vi.mock("@/integrations/slack/client", async () => {
  const actual = await vi.importActual<typeof import("@/integrations/slack/client")>(
    "@/integrations/slack/client"
  );
  return { ...actual, postMessage: postMessageMock };
});

const { getSlackInstallationForWorkspaceMock } = vi.hoisted(() => ({
  getSlackInstallationForWorkspaceMock: vi.fn(),
}));
vi.mock("@/db/queries", () => ({
  getSlackInstallationForWorkspace: getSlackInstallationForWorkspaceMock,
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

import { deliverPredictionToSlack, deliverAlertToSlack } from "@/integrations/slack/delivery";

const WS = "22222222-2222-4222-8222-222222222222";

const PREDICTION = {
  statement: "Acme ships a first-party Postgres adapter",
  competitor_name: "Acme",
  probability: 0.72,
  resolves_at: new Date("2026-12-24T00:00:00.000Z"),
  evidence_count: 9,
  pattern_type: "product_launch",
};

describe("Slack delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSlackInstallationForWorkspaceMock.mockResolvedValue({
      bot_token: "xoxb-test",
      default_channel: "C1",
    });
    postMessageMock.mockResolvedValue({ ts: "1.0" });
  });

  it("posts a prediction to the workspace's connected channel", async () => {
    await deliverPredictionToSlack(WS, PREDICTION);

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const [input] = postMessageMock.mock.calls[0];
    expect(input.channel).toBe("C1");
    expect(input.token).toBe("xoxb-test");
    expect(JSON.stringify(input.blocks)).toContain("72%");
  });

  it("does nothing when the workspace has not connected Slack", async () => {
    getSlackInstallationForWorkspaceMock.mockResolvedValue(undefined);

    await deliverPredictionToSlack(WS, PREDICTION);

    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("does nothing when Slack is connected but no channel is chosen", async () => {
    // Posting to an arbitrary channel because none was configured is worse than
    // not posting: it puts competitive intelligence somewhere nobody chose.
    getSlackInstallationForWorkspaceMock.mockResolvedValue({
      bot_token: "xoxb-test",
      default_channel: null,
    });

    await deliverPredictionToSlack(WS, PREDICTION);

    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("swallows a Slack failure so the caller's work still completes", async () => {
    // A Slack outage must never cost a day's analysis run or leave a resolved
    // prediction unrecorded. The durable artifact is already in Postgres.
    postMessageMock.mockRejectedValue(new Error("slack is down"));

    await expect(deliverPredictionToSlack(WS, PREDICTION)).resolves.toBeUndefined();
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("swallows a lookup failure too", async () => {
    getSlackInstallationForWorkspaceMock.mockRejectedValue(new Error("db down"));

    await expect(deliverPredictionToSlack(WS, PREDICTION)).resolves.toBeUndefined();
  });

  it("delivers alerts through the same guarded path", async () => {
    await deliverAlertToSlack(WS, {
      competitor_name: "Acme",
      pattern: "Upmarket pivot",
      confidence: 0.81,
      interpretation: "SMB segment is being abandoned.",
      recommended_actions: [],
    });

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(postMessageMock.mock.calls[0][0].blocks)).toContain("Upmarket pivot");
  });
});
