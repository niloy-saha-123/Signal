import { describe, it, expect, vi, beforeEach } from "vitest";

const { store, safeFetchMock } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  safeFetchMock: vi.fn(),
}));
vi.mock("@/lib/redis-client", () => ({
  cacheRedis: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes("NX") && store.has(k)) return null;
      store.set(k, v);
      return "OK";
    }),
    incr: vi.fn(async (k: string) => {
      const n = Number(store.get(k) ?? 0) + 1;
      store.set(k, String(n));
      return n;
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  },
}));
vi.mock("@/db/client", () => ({
  db: { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: safeFetchMock }));

import { postMessage } from "@/integrations/slack/client";

const INPUT = { token: "xoxb-1", channel: "C1", blocks: [], fallbackText: "hi" };
const slackAnswer = (body: object, status = 200) => ({
  status,
  text: async () => JSON.stringify(body),
});

describe("postMessage circuit breaker", () => {
  beforeEach(() => {
    store.clear();
    safeFetchMock.mockReset();
  });

  it("per-workspace Slack errors do not trip the shared breaker", async () => {
    safeFetchMock.mockResolvedValue(slackAnswer({ ok: false, error: "not_in_channel" }));
    for (let i = 0; i < 6; i++) {
      await expect(postMessage(INPUT)).rejects.toThrow(/not_in_channel/);
    }
    safeFetchMock.mockResolvedValue(slackAnswer({ ok: true, ts: "1.2" }));
    await expect(postMessage(INPUT)).resolves.toEqual({ ts: "1.2" });
  });

  it("transport failures still open it after 5", async () => {
    safeFetchMock.mockResolvedValue(slackAnswer({}, 500));
    for (let i = 0; i < 5; i++) {
      await expect(postMessage(INPUT)).rejects.toThrow(/HTTP 500/);
    }
    await expect(postMessage(INPUT)).rejects.toThrow(/circuit is open/);
  });

  it("ratelimited ok:false counts as a transport failure", async () => {
    safeFetchMock.mockResolvedValue(slackAnswer({ ok: false, error: "ratelimited" }));
    for (let i = 0; i < 5; i++) {
      await expect(postMessage(INPUT)).rejects.toThrow(/ratelimited/);
    }
    await expect(postMessage(INPUT)).rejects.toThrow(/circuit is open/);
  });
});
