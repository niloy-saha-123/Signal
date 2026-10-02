import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, string>();
const { set, getdel } = vi.hoisted(() => ({ set: vi.fn(), getdel: vi.fn() }));
vi.mock("@/lib/redis-client", () => ({ cacheRedis: { set, getdel } }));

import { savePendingInstall, takePendingInstall } from "@/integrations/slack/pending-install";

const PENDING = {
  workspace_id: "ws-1",
  user_id: "user-1",
  result: {
    team_id: "T1",
    team_name: "Acme",
    bot_token: "xoxb-1",
    bot_user_id: "U1",
    channel_id: "C1",
    channel_name: "#intel",
  },
};

describe("pending slack install", () => {
  beforeEach(() => {
    store.clear();
    set.mockReset().mockImplementation(async (k: string, v: string) => void store.set(k, v));
    getdel.mockReset().mockImplementation(async (k: string) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return v;
    });
  });

  it("round-trips a parked install", async () => {
    const id = await savePendingInstall(PENDING);
    expect(await takePendingInstall(id)).toEqual(PENDING);
  });

  it("is single use", async () => {
    const id = await savePendingInstall(PENDING);
    await takePendingInstall(id);
    expect(await takePendingInstall(id)).toBeNull();
  });

  it("expires after 600 seconds", async () => {
    await savePendingInstall(PENDING);
    expect(set).toHaveBeenCalledWith(expect.stringMatching(/^slack:pending-install:/), expect.any(String), "EX", 600);
  });

  it("rejects a malformed id without touching Redis", async () => {
    expect(await takePendingInstall("short")).toBeNull();
    expect(await takePendingInstall("../".repeat(20))).toBeNull();
    expect(getdel).not.toHaveBeenCalled();
  });
});
