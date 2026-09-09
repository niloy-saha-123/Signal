import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));

const { listCompetitorsMock, getLatestSignalCollectedAtMock, signalExistsBySourceUrlMock, createSignalMock } =
  vi.hoisted(() => ({
    listCompetitorsMock: vi.fn(),
    getLatestSignalCollectedAtMock: vi.fn(),
    signalExistsBySourceUrlMock: vi.fn(),
    createSignalMock: vi.fn(),
  }));

vi.mock("../db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  getLatestSignalCollectedAt: getLatestSignalCollectedAtMock,
  signalExistsBySourceUrl: signalExistsBySourceUrlMock,
  createSignal: createSignalMock,
}));

const { queueAddMock, registerWorkerMock } = vi.hoisted(() => ({
  queueAddMock: vi.fn().mockResolvedValue(undefined),
  registerWorkerMock: vi.fn(),
}));

vi.mock("../queues/registry", () => ({
  registerWorker: registerWorkerMock,
  queues: { "pipeline-entity-extraction": { add: queueAddMock } },
}));

import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { redditCollectorProcessor, initRedditWorker } from "./reddit";

const activeCompetitor = { id: "c1", name: "Acme", is_active: true, subreddits: ["acme"] };
const noSubredditsCompetitor = { id: "c2", name: "NoSubs", is_active: true, subreddits: [] };
const inactiveCompetitor = { id: "c3", name: "Zeta", is_active: false, subreddits: ["zeta"] };

function tokenResponse(token = "test-token") {
  return { ok: true, status: 200, json: async () => ({ access_token: token }) };
}

function listingResponse(posts: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { children: posts.map((data) => ({ kind: "t3", data })) } }),
  };
}

describe("collectors/reddit", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    listCompetitorsMock.mockResolvedValue([activeCompetitor, inactiveCompetitor]);
    getLatestSignalCollectedAtMock.mockResolvedValue(undefined);
    signalExistsBySourceUrlMock.mockResolvedValue(false);
    createSignalMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "s1",
      ...input,
    }));
    fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("access_token")) return tokenResponse();
      return listingResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("short-circuits without hitting the network when the reddit circuit is open", async () => {
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await expect(redditCollectorProcessor({} as never)).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(listCompetitorsMock).not.toHaveBeenCalled();
  });

  it("fetches an OAuth token once per job run and reuses it across competitors", async () => {
    listCompetitorsMock.mockResolvedValue([
      activeCompetitor,
      { id: "c4", name: "Other", is_active: true, subreddits: ["other"] },
    ]);

    await redditCollectorProcessor({} as never);

    const tokenCalls = fetchMock.mock.calls.filter((call: any[]) => call[0].includes("access_token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("sends client credentials as HTTP Basic auth when requesting the OAuth token", async () => {
    process.env.REDDIT_CLIENT_ID = "cid";
    process.env.REDDIT_CLIENT_SECRET = "csecret";

    await redditCollectorProcessor({} as never);

    const [, options] = fetchMock.mock.calls.find((call: any[]) => call[0].includes("access_token"))!;
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from("cid:csecret").toString("base64")}`
    );
    expect(options.body).toBe("grant_type=client_credentials");
  });

  it("skips competitors with an empty subreddits array without erroring", async () => {
    listCompetitorsMock.mockResolvedValue([noSubredditsCompetitor]);

    await expect(redditCollectorProcessor({} as never)).resolves.toBeUndefined();

    const listingCalls = fetchMock.mock.calls.filter((call: any[]) => call[0].includes("oauth.reddit.com"));
    expect(listingCalls).toHaveLength(0);
  });

  it("queries the subreddit listing endpoint only for active competitors, with bearer auth and user-agent", async () => {
    process.env.REDDIT_USER_AGENT = "Signal/1.0";

    await redditCollectorProcessor({} as never);

    const listingCalls = fetchMock.mock.calls.filter((call: any[]) => call[0].includes("oauth.reddit.com"));
    expect(listingCalls).toHaveLength(1);
    const [url, options] = listingCalls[0];
    expect(url).toBe("https://oauth.reddit.com/r/acme/new.json?limit=25");
    expect(options.headers.Authorization).toBe("Bearer test-token");
    expect(options.headers["User-Agent"]).toBe("Signal/1.0");
  });

  it("uses a 7-day-ago window when no prior signal exists, filtering out older posts", async () => {
    const before = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("access_token")) return tokenResponse();
      return listingResponse([
        {
          id: "old1",
          name: "t3_old1",
          permalink: "/r/acme/comments/old1/old_post/",
          title: "Old post",
          selftext: "too old",
          created_utc: before - 1000,
        },
      ]);
    });

    await redditCollectorProcessor({} as never);

    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("uses the last collected_at as the watermark when one exists", async () => {
    const lastCollectedAt = new Date("2026-08-01T00:00:00.000Z");
    getLatestSignalCollectedAtMock.mockResolvedValue(lastCollectedAt);
    const watermarkSeconds = Math.floor(lastCollectedAt.getTime() / 1000);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("access_token")) return tokenResponse();
      return listingResponse([
        {
          id: "p1",
          name: "t3_p1",
          permalink: "/r/acme/comments/p1/new_post/",
          title: "New post",
          selftext: "fresh",
          created_utc: watermarkSeconds + 1000,
        },
      ]);
    });

    await redditCollectorProcessor({} as never);

    expect(getLatestSignalCollectedAtMock).toHaveBeenCalledWith("c1", "reddit");
    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ source_url: "https://www.reddit.com/r/acme/comments/p1/new_post/" })
    );
  });

  it("inserts a new signal per post, deduped by source_url, and enqueues entity extraction", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("access_token")) return tokenResponse();
      return listingResponse([
        {
          id: "111",
          name: "t3_111",
          permalink: "/r/acme/comments/111/acme_launches_thing/",
          title: "Acme launches thing",
          selftext: "Acme just shipped a new feature",
          created_utc: Math.floor(Date.now() / 1000),
        },
      ]);
    });

    await redditCollectorProcessor({} as never);

    expect(signalExistsBySourceUrlMock).toHaveBeenCalledWith(
      "c1",
      "reddit",
      "https://www.reddit.com/r/acme/comments/111/acme_launches_thing/"
    );
    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitor_id: "c1",
        source: "reddit",
        source_url: "https://www.reddit.com/r/acme/comments/111/acme_launches_thing/",
        title: "Acme launches thing",
        raw_text: "Acme just shipped a new feature",
      })
    );
    expect(queueAddMock).toHaveBeenCalledWith(expect.any(String), { signal_id: "s1" });
  });

  it("skips a post whose source_url already exists for this competitor+source", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("access_token")) return tokenResponse();
      return listingResponse([
        {
          id: "111",
          name: "t3_111",
          permalink: "/r/acme/comments/111/thing/",
          title: "Thing",
          selftext: "body",
          created_utc: Math.floor(Date.now() / 1000),
        },
      ]);
    });
    signalExistsBySourceUrlMock.mockResolvedValue(true);

    await redditCollectorProcessor({} as never);

    expect(createSignalMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("falls back to the post title as raw_text when selftext is empty (link posts)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("access_token")) return tokenResponse();
      return listingResponse([
        {
          id: "222",
          name: "t3_222",
          permalink: "/r/acme/comments/222/link_post/",
          title: "Acme link post",
          selftext: "",
          created_utc: Math.floor(Date.now() / 1000),
        },
      ]);
    });

    await redditCollectorProcessor({} as never);

    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ raw_text: "Acme link post" })
    );
  });

  it("records success after a clean run, and records failure without throwing the whole job when a competitor's fetch keeps failing", async () => {
    await redditCollectorProcessor({} as never);
    expect(recordSuccess).toHaveBeenCalledWith("reddit");
    expect(recordFailure).not.toHaveBeenCalled();

    vi.clearAllMocks();
    listCompetitorsMock.mockResolvedValue([activeCompetitor]);
    getLatestSignalCollectedAtMock.mockResolvedValue(undefined);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("access_token")) return tokenResponse();
      return { ok: false, status: 500, json: async () => ({}) };
    });

    await expect(redditCollectorProcessor({} as never)).resolves.toBeUndefined();
    expect(recordFailure).toHaveBeenCalledWith("reddit", expect.any(String));
    expect(recordSuccess).not.toHaveBeenCalled();
  }, 10000);

  it("keeps processing subsequent competitors when an earlier one's fetch keeps failing", async () => {
    const failingCompetitor = { id: "c-fail", name: "FailCo", is_active: true, subreddits: ["failco"] };
    listCompetitorsMock.mockResolvedValue([failingCompetitor, activeCompetitor]);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("access_token")) return tokenResponse();
      if (url.includes("/r/failco/")) {
        throw new Error("network down");
      }
      return listingResponse([
        {
          id: "333",
          name: "t3_333",
          permalink: "/r/acme/comments/333/mention/",
          title: "Acme mention",
          selftext: "body",
          created_utc: Math.floor(Date.now() / 1000),
        },
      ]);
    });

    await redditCollectorProcessor({} as never);

    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitor_id: "c1",
        source_url: "https://www.reddit.com/r/acme/comments/333/mention/",
      })
    );
    expect(recordFailure).toHaveBeenCalledWith("reddit", expect.any(String));
    expect(recordSuccess).not.toHaveBeenCalled();
  }, 10000);

  it("keeps processing a healthy sibling subreddit when an earlier subreddit for the SAME competitor keeps failing", async () => {
    const multiSubCompetitor = {
      id: "c5",
      name: "MultiSub",
      is_active: true,
      subreddits: ["badsub", "goodsub"],
    };
    listCompetitorsMock.mockResolvedValue([multiSubCompetitor]);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("access_token")) return tokenResponse();
      if (url.includes("/r/badsub/")) {
        throw new Error("network down");
      }
      if (url.includes("/r/goodsub/")) {
        return listingResponse([
          {
            id: "444",
            name: "t3_444",
            permalink: "/r/goodsub/comments/444/mention/",
            title: "MultiSub mention",
            selftext: "body",
            created_utc: Math.floor(Date.now() / 1000),
          },
        ]);
      }
      return listingResponse([]);
    });

    await redditCollectorProcessor({} as never);

    // The healthy sibling subreddit listed AFTER the failing one still got
    // processed — a bad subreddit doesn't starve the rest of the array.
    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitor_id: "c5",
        source_url: "https://www.reddit.com/r/goodsub/comments/444/mention/",
      })
    );
    expect(recordFailure).toHaveBeenCalledWith("reddit", expect.any(String));
    expect(recordSuccess).not.toHaveBeenCalled();
  }, 10000);

  it("sets a 30s abort timeout on the OAuth token request and the subreddit listing fetch", async () => {
    await redditCollectorProcessor({} as never);

    for (const call of fetchMock.mock.calls) {
      const [, options] = call;
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("keeps processing subsequent posts in the same subreddit's batch when an earlier post fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("access_token")) return tokenResponse();
      return listingResponse([
        {
          id: "bad",
          name: "t3_bad",
          permalink: "/r/acme/comments/bad/bad_post/",
          title: "Bad post",
          selftext: "bad body",
          created_utc: Math.floor(Date.now() / 1000),
        },
        {
          id: "good",
          name: "t3_good",
          permalink: "/r/acme/comments/good/good_post/",
          title: "Good post",
          selftext: "good body",
          created_utc: Math.floor(Date.now() / 1000),
        },
      ]);
    });
    createSignalMock
      .mockImplementationOnce(async () => {
        throw new Error("insert failed");
      })
      .mockImplementationOnce(async (input: Record<string, unknown>) => ({ id: "s2", ...input }));

    await redditCollectorProcessor({} as never);

    expect(createSignalMock).toHaveBeenCalledTimes(2);
    expect(queueAddMock).toHaveBeenCalledWith(expect.any(String), { signal_id: "s2" });
    // A single item's failure is logged and skipped — it's not a
    // subreddit/competitor-level failure, so the run still records success.
    expect(recordSuccess).toHaveBeenCalledWith("reddit");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("stops attempting remaining competitors once the circuit trips mid-run", async () => {
    const secondCompetitor = { id: "c2b", name: "Later", is_active: true, subreddits: ["later"] };
    listCompetitorsMock.mockResolvedValue([activeCompetitor, secondCompetitor]);
    (isCircuitOpen as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false) // initial job-level check
      .mockResolvedValueOnce(false) // before competitor 1
      .mockResolvedValueOnce(true); // before competitor 2 — breaks

    await redditCollectorProcessor({} as never);

    const listingCalls = fetchMock.mock.calls.filter((call: any[]) => call[0].includes("oauth.reddit.com"));
    expect(listingCalls).toHaveLength(1);
    expect(listingCalls[0][0]).toBe("https://oauth.reddit.com/r/acme/new.json?limit=25");
    // Regression guard: a mid-run trip must not force-close a circuit that
    // was just correctly observed open (e.g. tripped by a concurrent run of
    // this same collector) — recordSuccess must not fire on this exit path,
    // even though every competitor actually attempted came back clean.
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("registers the collect-reddit worker via initRedditWorker without registering at import time", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();

    initRedditWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith("collect-reddit", redditCollectorProcessor);
  });
});
