import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  isCircuitMarkedOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/retry", () => ({ withRetry: (fn: () => unknown) => fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { listCompetitorsMock, saveDiscoveredLinksMock, getLatestSignalCollectedAtMock, signalExistsBySourceUrlMock, createSignalMock } =
  vi.hoisted(() => ({
    listCompetitorsMock: vi.fn(),
    saveDiscoveredLinksMock: vi.fn(),
    getLatestSignalCollectedAtMock: vi.fn(),
    signalExistsBySourceUrlMock: vi.fn(),
    createSignalMock: vi.fn(),
  }));

vi.mock("@/db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  saveDiscoveredLinks: saveDiscoveredLinksMock,
  getLatestSignalCollectedAt: getLatestSignalCollectedAtMock,
  signalExistsBySourceUrl: signalExistsBySourceUrlMock,
  createSignal: createSignalMock,
}));

const { registerWorkerMock, enqueueInitialSignalPipelineMock } = vi.hoisted(() => ({
  registerWorkerMock: vi.fn(),
  enqueueInitialSignalPipelineMock: vi.fn(),
}));
vi.mock("@/queues/registry", () => ({
  registerWorker: registerWorkerMock,
  queues: { "pipeline-entity-extraction": { add: vi.fn() } },
}));
vi.mock("@/pipeline/recovery", () => ({
  enqueueInitialSignalPipeline: enqueueInitialSignalPipelineMock,
}));

const { safeFetchMock, assertPublicUrlMock } = vi.hoisted(() => ({
  safeFetchMock: vi.fn(),
  assertPublicUrlMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: safeFetchMock,
  assertPublicUrl: assertPublicUrlMock,
}));

const { parseStringMock } = vi.hoisted(() => ({ parseStringMock: vi.fn() }));
vi.mock("rss-parser", () => ({
  default: class {
    parseString(body: string) {
      return parseStringMock(body);
    }
  },
}));

import { isCircuitOpen, recordFailure, recordSuccess } from "@/reliability/circuit-breaker";
import { feedsCollectorProcessor, initFeedsWorker } from "@/collectors/feeds";

const DAY = 24 * 60 * 60 * 1000;
const LONG_TEXT = "Post body text. ".repeat(40);

function comp(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    name: "Kestrel",
    domain: "kestrel.dev",
    is_active: true,
    is_own_company: false,
    links_scanned_at: new Date(),
    changelog_rss: null,
    postings_rss: null,
    blog_feeds: [],
    social_feeds: [],
    forum_feeds: [],
    bluesky_handle: null,
    stackoverflow_tag: null,
    ...over,
  };
}

const item = {
  link: "https://kestrel.dev/p/1",
  title: "Post",
  "content:encoded": `<p>${LONG_TEXT}</p>`,
  isoDate: "2026-09-01T00:00:00.000Z",
};

const HOMEPAGE = `<head>
<link rel="alternate" type="application/rss+xml" href="/blog/rss.xml">
<link rel="alternate" type="application/atom+xml" href="https://kestrel.dev/changelog.atom">
</head><body>
<a href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">yt</a>
<a href="https://bsky.app/profile/kestrel.dev">bsky</a></body>`;

describe("collectors/feeds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    listCompetitorsMock.mockResolvedValue([]);
    getLatestSignalCollectedAtMock.mockResolvedValue(undefined);
    signalExistsBySourceUrlMock.mockResolvedValue(false);
    createSignalMock.mockImplementation(async (input: Record<string, unknown>) => ({ id: "s1", ...input }));
    enqueueInitialSignalPipelineMock.mockResolvedValue("added");
    parseStringMock.mockResolvedValue({ items: [item] });
    safeFetchMock.mockResolvedValue({ status: 200, text: async () => HOMEPAGE });
    assertPublicUrlMock.mockResolvedValue(undefined);
  });

  it("registers the worker", () => {
    initFeedsWorker();
    expect(registerWorkerMock).toHaveBeenCalledWith("collect-feeds", feedsCollectorProcessor);
  });

  it("link scan fills only unset config and drops known feeds", async () => {
    listCompetitorsMock.mockResolvedValue([
      comp({
        links_scanned_at: null,
        social_feeds: ["https://user-set.example/feed"],
        changelog_rss: "https://kestrel.dev/changelog.atom",
      }),
    ]);
    parseStringMock.mockResolvedValue({ items: [] });

    await feedsCollectorProcessor({} as never);

    expect(saveDiscoveredLinksMock).toHaveBeenCalledTimes(1);
    const [id, patch] = saveDiscoveredLinksMock.mock.calls[0];
    expect(id).toBe("c1");
    expect(patch.blog_feeds).toEqual(["https://kestrel.dev/blog/rss.xml"]);
    expect(patch).not.toHaveProperty("social_feeds");
    expect(patch.bluesky_handle).toBe("kestrel.dev");
  });

  it("skips the scan when recent or own company, rescans after 30 days", async () => {
    listCompetitorsMock.mockResolvedValue([
      comp({ links_scanned_at: new Date(Date.now() - 5 * DAY) }),
      comp({ id: "own", is_own_company: true, links_scanned_at: null }),
    ]);
    await feedsCollectorProcessor({} as never);
    expect(saveDiscoveredLinksMock).not.toHaveBeenCalled();

    listCompetitorsMock.mockResolvedValue([comp({ links_scanned_at: new Date(Date.now() - 31 * DAY) })]);
    await feedsCollectorProcessor({} as never);
    expect(saveDiscoveredLinksMock).toHaveBeenCalledTimes(1);
  });

  it("stamps the scan even when nothing is found", async () => {
    listCompetitorsMock.mockResolvedValue([comp({ links_scanned_at: null })]);
    safeFetchMock.mockResolvedValue({ status: 200, text: async () => "<html></html>" });
    await feedsCollectorProcessor({} as never);
    expect(saveDiscoveredLinksMock).toHaveBeenCalledWith("c1", {});
  });

  it("blog sweep continues past a failing feed without recording a failure", async () => {
    listCompetitorsMock.mockResolvedValue([comp({ blog_feeds: ["https://a.example/feed", "https://b.example/feed"] })]);
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("https://a.example")) throw new Error("boom");
      return { status: 200, text: async () => "<feed />" };
    });

    // runSourceSweep isolates per-competitor failures, so the job itself resolves.
    await feedsCollectorProcessor({} as never);

    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(createSignalMock).toHaveBeenCalledWith(expect.objectContaining({ source: "blog" }));
    expect(recordFailure).not.toHaveBeenCalledWith("blog", expect.anything());
    expect(recordSuccess).toHaveBeenCalledWith("blog");
  });

  it("records a blog failure when all of a competitor's feeds fail", async () => {
    listCompetitorsMock.mockResolvedValue([comp({ blog_feeds: ["https://a.example/feed", "https://b.example/feed"] })]);
    safeFetchMock.mockRejectedValue(new Error("boom"));
    await feedsCollectorProcessor({} as never);
    expect(createSignalMock).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith("blog", expect.any(String));
  });

  it("social sweep never fetches the item page", async () => {
    listCompetitorsMock.mockResolvedValue([comp({ social_feeds: ["https://yt.example/feed"] })]);
    parseStringMock.mockResolvedValue({
      items: [{ link: "https://www.youtube.com/watch?v=1", title: "Video", contentSnippet: LONG_TEXT, isoDate: "2026-09-01T00:00:00.000Z" }],
    });
    safeFetchMock.mockResolvedValue({ status: 200, text: async () => "<feed />" });

    await feedsCollectorProcessor({} as never);

    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(safeFetchMock.mock.calls[0][0]).toBe("https://yt.example/feed");
    expect(createSignalMock).toHaveBeenCalledWith(expect.objectContaining({ source: "social" }));
  });

  it("forums sweep stores source community", async () => {
    listCompetitorsMock.mockResolvedValue([comp({ forum_feeds: ["https://forum.example/feed"] })]);
    safeFetchMock.mockResolvedValue({ status: 200, text: async () => "<feed />" });
    await feedsCollectorProcessor({} as never);
    expect(createSignalMock).toHaveBeenCalledWith(expect.objectContaining({ source: "community" }));
  });

  it("an open blog circuit does not stop the other sweeps; error rethrown", async () => {
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockImplementation(async (s: string) => s === "blog");
    listCompetitorsMock.mockResolvedValue([
      comp({ blog_feeds: ["https://a.example/feed"], social_feeds: ["https://s.example/feed"], forum_feeds: ["https://f.example/feed"] }),
    ]);
    safeFetchMock.mockResolvedValue({ status: 200, text: async () => "<feed />" });

    await expect(feedsCollectorProcessor({} as never)).rejects.toThrow(/blog circuit is open/);

    const sources = createSignalMock.mock.calls.map((c) => c[0].source).sort();
    expect(sources).toEqual(["community", "social"]);
  });
});
