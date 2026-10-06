import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis-client", () => ({ redis: {}, cacheRedis: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createSlackThrottle, SLACK_LIMITS } from "@/integrations/slack/throttle";

describe("createSlackThrottle", () => {
  it("checks the user and team windows with the kind's limits", async () => {
    const hit = vi.fn().mockResolvedValue({ allowed: true });
    expect(await createSlackThrottle(hit)("ask", "T1", "U1")).toBe(true);
    expect(hit).toHaveBeenCalledWith("slack:ask:user:T1:U1", SLACK_LIMITS.ask.perUser, 3_600);
    expect(hit).toHaveBeenCalledWith("slack:ask:team:T1", SLACK_LIMITS.ask.perTeam, 3_600);
  });

  it("refuses when either window is spent", async () => {
    const hit = vi.fn(async (key: string) => ({ allowed: !key.includes(":team:") }));
    expect(await createSlackThrottle(hit)("intel", "T1", "U1")).toBe(false);
  });

  it("fails open when Redis errors", async () => {
    const hit = vi.fn().mockRejectedValue(new Error("redis down"));
    expect(await createSlackThrottle(hit)("ask", "T1", "U1")).toBe(true);
  });
});
