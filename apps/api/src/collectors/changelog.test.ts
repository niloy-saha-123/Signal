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

const { parseURLMock, capturedParserOptions } = vi.hoisted(() => ({
  parseURLMock: vi.fn(),
  // A plain array, not a vi.fn() call log — the Parser is constructed once
  // at module import time (before any test's beforeEach/vi.clearAllMocks
  // runs), so a vi.fn()'s call history would already be wiped by the time
  // the first test asserts on it.
  capturedParserOptions: [] as unknown[],
}));

vi.mock("rss-parser", () => ({
  default: class {
    constructor(options?: unknown) {
      capturedParserOptions.push(options);
    }
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

  it("uses embedded content:encoded as raw_text without fetching the entry", async () => {
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

  it("trusts a short content:encoded outright — length never forces a fetch when it's present", async () => {
    parseURLMock.mockResolvedValue(
      feed([
        {
          link: "https://acme.example.com/posts/short",
          title: "Tiny patch",
          "content:encoded": "<p>v2.1: bug fixes.</p>",
        },
      ])
    );

    await changelogCollectorProcessor({} as never);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source_url: "https://acme.example.com/posts/short",
        raw_text: "v2.1: bug fixes.",
      })
    );
  });

  it("fetches the entry page even when a content:encoded-less <description> is long but still just an excerpt", async () => {
    // A long-but-truncated CMS teaser easily clears any naive length
    // threshold while still being incomplete — content:encoded is absent
    // here (only .content, RSS2's <description>-sourced field), so this
    // must never be trusted as full text no matter how long it reads.
    const truncatedExcerpt =
      "Here's what's new in this release: a bunch of exciting changes across the product, " +
      "performance improvements, bug fixes, and various small tweaks based on your feedback. " +
      "We've also improved reliability and squashed several long-standing issues... ".repeat(4) +
      "Read the full post on our blog";
    expect(truncatedExcerpt.length).toBeGreaterThan(500);

    parseURLMock.mockResolvedValue(
      feed([
        {
          link: "https://acme.example.com/posts/teaser",
          title: "Big release",
          content: truncatedExcerpt,
          isoDate: "2026-08-01T00:00:00.000Z",
        },
      ])
    );
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html><body><article>" + LONG_TEXT + "</article></body></html>",
    });

    await changelogCollectorProcessor({} as never);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://acme.example.com/posts/teaser",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source_url: "https://acme.example.com/posts/teaser",
        raw_text: expect.stringContaining("Full release notes body text."),
      })
    );
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

    expect(fetchMock).toHaveBeenCalledWith(
      "https://acme.example.com/posts/2",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
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

  it("configures the RSS parser with a 30s timeout", () => {
    expect(capturedParserOptions[0]).toEqual({ timeout: 30000 });
  });

  it("sets a 30s abort timeout when fetching a changelog entry page", async () => {
    parseURLMock.mockResolvedValue(
      feed([{ link: "https://acme.example.com/posts/x", content: "short excerpt" }])
    );

    await changelogCollectorProcessor({} as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps processing subsequent feed entries when an earlier one fails", async () => {
    parseURLMock.mockResolvedValue(
      feed([
        { link: "https://acme.example.com/posts/bad", "content:encoded": `<p>${LONG_TEXT}</p>` },
        { link: "https://acme.example.com/posts/good", "content:encoded": `<p>${LONG_TEXT}</p>` },
      ])
    );
    createSignalMock
      .mockImplementationOnce(async () => {
        throw new Error("insert failed");
      })
      .mockImplementationOnce(async (input: Record<string, unknown>) => ({ id: "s2", ...input }));

    await changelogCollectorProcessor({} as never);

    expect(createSignalMock).toHaveBeenCalledTimes(2);
    expect(queueAddMock).toHaveBeenCalledWith(expect.any(String), { signal_id: "s2" });
    // A single entry's failure is logged and skipped — it's not a
    // competitor-level failure, so the run still records success.
    expect(recordSuccess).toHaveBeenCalledWith("changelog");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("stops attempting remaining competitors once the circuit trips mid-run", async () => {
    const secondCompetitor = {
      id: "c2b",
      name: "Later",
      is_active: true,
      changelog_rss: "https://later.example.com/changelog.rss",
    };
    listCompetitorsMock.mockResolvedValue([activeCompetitor, secondCompetitor]);
    (isCircuitOpen as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false) // initial job-level check
      .mockResolvedValueOnce(false) // before competitor 1
      .mockResolvedValueOnce(true); // before competitor 2 — breaks

    await changelogCollectorProcessor({} as never);

    expect(parseURLMock).toHaveBeenCalledTimes(1);
    expect(parseURLMock).toHaveBeenCalledWith(activeCompetitor.changelog_rss);
    // Regression guard: a mid-run trip must not force-close a circuit that
    // was just correctly observed open (e.g. tripped by a concurrent run of
    // this same collector) — recordSuccess must not fire on this exit path,
    // even though every competitor actually attempted came back clean.
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("registers the collect-changelog worker via initChangelogWorker without registering at import time", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();

    initChangelogWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith("collect-changelog", changelogCollectorProcessor);
  });
});
