import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/queues/registry", () => ({ registerWorker: vi.fn() }));

import { isQuietWeek, runSlackDigest, type SlackDigestDeps } from "@/integrations/slack/digest";

const BUSY = {
  alert_count: 1,
  top_alerts: [{ competitor_name: "Kestrel", pattern: "p", confidence: 0.5 }],
  new_forecast_count: 0,
  new_forecasts: [],
  settled: [],
  open_count: 0,
};
const QUIET = { ...BUSY, alert_count: 0, top_alerts: [] };
const NOW = new Date("2026-10-05T09:00:00Z");

function install(workspace_id: string, channel = "C1") {
  return { workspace_id, bot_token: `xoxb-${workspace_id}`, default_channel: channel } as any;
}

function makeDeps(overrides: Partial<SlackDigestDeps> = {}): SlackDigestDeps {
  return {
    listInstallations: vi.fn().mockResolvedValue([install("w1")]),
    getWeeklyDigest: vi.fn().mockResolvedValue(BUSY),
    postMessage: vi.fn().mockResolvedValue({ ts: "1" }),
    claimDigestSend: vi.fn().mockResolvedValue(true),
    releaseDigestSend: vi.fn().mockResolvedValue(undefined),
    appUrl: "https://app.test",
    now: () => NOW,
    ...overrides,
  };
}

describe("runSlackDigest", () => {
  it("posts each workspace's last seven days to its channel", async () => {
    const deps = makeDeps();
    await runSlackDigest(deps);
    expect(deps.getWeeklyDigest).toHaveBeenCalledWith("w1", new Date("2026-09-28T09:00:00Z"));
    expect(deps.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ token: "xoxb-w1", channel: "C1", fallbackText: expect.stringContaining("1 alert") })
    );
  });

  it("posts nothing for a quiet week", async () => {
    const deps = makeDeps({ getWeeklyDigest: vi.fn().mockResolvedValue(QUIET) });
    await runSlackDigest(deps);
    expect(deps.postMessage).not.toHaveBeenCalled();
    expect(isQuietWeek(QUIET)).toBe(true);
    expect(isQuietWeek(BUSY)).toBe(false);
  });

  it("keeps going when one workspace's post fails (e.g. bot removed from channel), then fails the job", async () => {
    const deps = makeDeps({
      listInstallations: vi.fn().mockResolvedValue([install("w1"), install("w2")]),
      postMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error("Slack chat.postMessage failed: not_in_channel"))
        .mockResolvedValueOnce({ ts: "2" }),
    });
    await expect(runSlackDigest(deps)).rejects.toThrow(/1 of 2/);
    expect(deps.postMessage).toHaveBeenCalledTimes(2);
  });

  it("posts nothing to a workspace that already got this week's digest", async () => {
    const deps = makeDeps({ claimDigestSend: vi.fn().mockResolvedValue(false) });
    await runSlackDigest(deps);
    expect(deps.claimDigestSend).toHaveBeenCalledWith("w1", "2026-W41");
    expect(deps.postMessage).not.toHaveBeenCalled();
  });

  it("does not claim a quiet week", async () => {
    const deps = makeDeps({ getWeeklyDigest: vi.fn().mockResolvedValue(QUIET) });
    await runSlackDigest(deps);
    expect(deps.claimDigestSend).not.toHaveBeenCalled();
  });

  it("releases the claim when the post fails so a retry can send", async () => {
    const deps = makeDeps({ postMessage: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(runSlackDigest(deps)).rejects.toThrow(/1 of 1/);
    expect(deps.releaseDigestSend).toHaveBeenCalledWith("w1", "2026-W41");
  });
});
