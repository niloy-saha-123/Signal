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

const { parseURLMock } = vi.hoisted(() => ({
  parseURLMock: vi.fn(),
}));

vi.mock("rss-parser", () => ({
  default: class {
    parseURL(url: string) {
      return parseURLMock(url);
    }
  },
}));

import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { changelogCollectorProcessor, initChangelogWorker } from "./changelog";

const activeCompetitor = {
  id: "c1",
  name: "Acme",
  is_active: true,
  changelog_rss: "https://acme.example.com/changelog.rss",
};
const inactiveCompetitor = {
  id: "c2",
  name: "Zeta",
  is_active: false,
  changelog_rss: "https://zeta.example.com/changelog.rss",
};
const noFeedCompetitor = { id: "c3", name: "NoFeed", is_active: true, changelog_rss: null };

const LONG_TEXT = "Full release notes body text. ".repeat(30); // > 500 chars

function feed(items: unknown[]) {
  return { items };
}

describe("collectors/changelog", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    listCompetitorsMock.mockResolvedValue([activeCompetitor, inactiveCompetitor, noFeedCompetitor]);
    getLatestSignalCollectedAtMock.mockResolvedValue(undefined);
    signalExistsBySourceUrlMock.mockResolvedValue(false);
    createSignalMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "s1",
      ...input,
    }));
    parseURLMock.mockResolvedValue(feed([]));
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "<body>fallback</body>" });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("short-circuits without hitting the network when the changelog circuit is open", async () => {
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await expect(changelogCollectorProcessor({} as never)).rejects.toThrow();

    expect(parseURLMock).not.toHaveBeenCalled();
    expect(listCompetitorsMock).not.toHaveBeenCalled();
  });

  it("parses the feed only for active competitors with a changelog_rss set", async () => {
    await changelogCollectorProcessor({} as never);

    expect(parseURLMock).toHaveBeenCalledTimes(1);
    expect(parseURLMock).toHaveBeenCalledWith(activeCompetitor.changelog_rss);
  });

  it("uses embedded content:encoded as raw_text when it's long enough to be full-text, without fetching the entry", async () => {
    parseURLMock.mockResolvedValue(
      feed([
        {
          link: "https://acme.example.com/posts/1",
          title: "v2.0 released",
          "content:encoded": `<p>${LONG_TEXT}</p>`,
          isoDate: "2026-08-01T00:00:00.000Z",
        },
      ])
    );

    await changelogCollectorProcessor({} as never);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitor_id: "c1",
        source: "changelog",
        source_url: "https://acme.example.com/posts/1",
        title: "v2.0 released",
        raw_text: expect.stringContaining("Full release notes body text."),
      })
    );
    expect(queueAddMock).toHaveBeenCalledWith(expect.any(String), { signal_id: "s1" });
  });

  it("fetches and parses the entry page via Cheerio when only a short summary is embedded", async () => {
    parseURLMock.mockResolvedValue(
      feed([
        {
          link: "https://acme.example.com/posts/2",
          title: "Small fix",
          content: "Short excerpt.",
          isoDate: "2026-08-01T00:00:00.000Z",
        },
      ])
    );
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        "<html><body><nav>skip</nav><article>" + LONG_TEXT + "</article></body></html>",
    });

    await changelogCollectorProcessor({} as never);

    expect(fetchMock).toHaveBeenCalledWith("https://acme.example.com/posts/2");
    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source_url: "https://acme.example.com/posts/2",
        raw_text: expect.stringContaining("Full release notes body text."),
      })
    );
  });

  it("skips a feed entry with no link (can't dedup or fetch it)", async () => {
    parseURLMock.mockResolvedValue(feed([{ title: "No link", content: LONG_TEXT }]));

    await changelogCollectorProcessor({} as never);

    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("skips entries older than the watermark without fetching or inserting", async () => {
    getLatestSignalCollectedAtMock.mockResolvedValue(new Date("2026-08-10T00:00:00.000Z"));
    parseURLMock.mockResolvedValue(
      feed([
        {
          link: "https://acme.example.com/posts/old",
          content: LONG_TEXT,
          isoDate: "2026-08-01T00:00:00.000Z",
        },
      ])
    );

    await changelogCollectorProcessor({} as never);

    expect(signalExistsBySourceUrlMock).not.toHaveBeenCalled();
    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("skips a feed entry whose source_url already exists for this competitor+source", async () => {
    parseURLMock.mockResolvedValue(
      feed([{ link: "https://acme.example.com/posts/dup", content: LONG_TEXT }])
    );
    signalExistsBySourceUrlMock.mockResolvedValue(true);

    await changelogCollectorProcessor({} as never);

    expect(createSignalMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("records success after a clean run, and records failure without throwing the whole job when a competitor's feed keeps failing", async () => {
    await changelogCollectorProcessor({} as never);
    expect(recordSuccess).toHaveBeenCalledWith("changelog");
    expect(recordFailure).not.toHaveBeenCalled();

    vi.clearAllMocks();
    listCompetitorsMock.mockResolvedValue([activeCompetitor]);
    getLatestSignalCollectedAtMock.mockResolvedValue(undefined);
    parseURLMock.mockRejectedValue(new Error("feed unreachable"));

    await expect(changelogCollectorProcessor({} as never)).resolves.toBeUndefined();
    expect(recordFailure).toHaveBeenCalledWith("changelog", expect.any(String));
    expect(recordSuccess).not.toHaveBeenCalled();
  }, 10000);

  it("keeps processing subsequent competitors when an earlier one's feed keeps failing", async () => {
    const failingCompetitor = {
      id: "c-fail",
      name: "FailCo",
      is_active: true,
      changelog_rss: "https://failco.example.com/changelog.rss",
    };
    listCompetitorsMock.mockResolvedValue([failingCompetitor, activeCompetitor]);
    parseURLMock.mockImplementation(async (url: string) => {
      if (url.includes("failco")) throw new Error("feed unreachable");
      return feed([{ link: "https://acme.example.com/posts/3", content: LONG_TEXT }]);
    });

    await changelogCollectorProcessor({} as never);

    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ source_url: "https://acme.example.com/posts/3" })
    );
    expect(recordFailure).toHaveBeenCalledWith("changelog", expect.any(String));
    expect(recordSuccess).not.toHaveBeenCalled();
  }, 10000);

  it("registers the collect-changelog worker via initChangelogWorker without registering at import time", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();

    initChangelogWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith("collect-changelog", changelogCollectorProcessor);
  });
});
