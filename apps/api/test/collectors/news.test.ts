import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  isCircuitMarkedOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));
const { listCompetitorsMock, existsMock, createSignalMock } = vi.hoisted(() => ({
  listCompetitorsMock: vi.fn(),
  existsMock: vi.fn(),
  createSignalMock: vi.fn(),
}));
vi.mock("@/db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  signalExistsBySourceUrl: existsMock,
  createSignal: createSignalMock,
}));
vi.mock("@/queues/registry", () => ({ registerWorker: vi.fn(), queues: {} }));
const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));
vi.mock("@/pipeline/recovery", () => ({ enqueueInitialSignalPipeline: enqueueMock }));
vi.mock("@/lib/retry", () => ({ withRetry: (fn: () => unknown) => fn() }));
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: safeFetchMock }));
const { parseStringMock } = vi.hoisted(() => ({ parseStringMock: vi.fn() }));
vi.mock("rss-parser", () => ({
  default: class {
    parseString(body: string) {
      return parseStringMock(body);
    }
  },
}));

import { recordFailure } from "@/reliability/circuit-breaker";
import { newsCollectorProcessor, newsFeedUrl } from "@/collectors/news";

const job = {} as any;
const ok = { status: 200, headers: new Headers(), text: async () => "<rss/>" };

function item(n: number, extra: Record<string, unknown> = {}) {
  return {
    title: `Kestrel raises Series B ${n} - TechDaily`,
    link: `https://news.google.com/rss/articles/A${n}`,
    isoDate: new Date(Date.UTC(2026, 8, n + 1)).toISOString(),
    content: `<a href="x">Kestrel raises Series B ${n}</a>&nbsp;<font>TechDaily</font>`,
    source: { _: "TechDaily", $: { url: "https://techdaily.example" } },
    ...extra,
  };
}

describe("newsFeedUrl", () => {
  it("quotes the competitor name by default and limits to the last 7 days", () => {
    const url = new URL(newsFeedUrl({ name: "Kestrel", news_query: null }));
    expect(url.origin + url.pathname).toBe("https://news.google.com/rss/search");
    expect(url.searchParams.get("q")).toBe('"Kestrel" when:7d');
    expect(url.searchParams.get("hl")).toBe("en-US");
  });

  it("uses news_query verbatim when set (name collisions like Linear)", () => {
    const url = new URL(newsFeedUrl({ name: "Linear", news_query: '"Linear" issue tracker' }));
    expect(url.searchParams.get("q")).toBe('"Linear" issue tracker when:7d');
  });
});

describe("news collector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCompetitorsMock.mockResolvedValue([
      { id: "c1", name: "Kestrel", news_query: null, is_active: true },
    ]);
    safeFetchMock.mockResolvedValue(ok);
    existsMock.mockResolvedValue(false);
    createSignalMock.mockImplementation(async (s: any) => ({ id: `sig-${s.source_url}` }));
  });

  it("emits one news signal per new article with headline, publisher and snippet", async () => {
    parseStringMock.mockResolvedValue({ items: [item(1)] });

    await newsCollectorProcessor(job);

    expect(safeFetchMock.mock.calls[0][0]).toContain("news.google.com/rss/search");
    expect(createSignalMock).toHaveBeenCalledTimes(1);
    const signal = createSignalMock.mock.calls[0][0];
    expect(signal).toMatchObject({
      competitor_id: "c1",
      source: "news",
      source_url: "https://news.google.com/rss/articles/A1",
      title: "Kestrel raises Series B 1 - TechDaily",
    });
    expect(signal.raw_text).toContain("Publisher: TechDaily");
    expect(signal.raw_text).not.toContain("<a");
    expect(enqueueMock).toHaveBeenCalledWith("sig-https://news.google.com/rss/articles/A1");
  });

  it("skips articles already collected", async () => {
    parseStringMock.mockResolvedValue({ items: [item(1), item(2)] });
    existsMock.mockImplementation(async (_c: string, _s: string, url: string) => url.endsWith("A1"));

    await newsCollectorProcessor(job);

    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(createSignalMock.mock.calls[0][0].source_url).toMatch(/A2$/);
  });

  it("takes the 20 newest articles, whatever order the feed lists them in", async () => {
    parseStringMock.mockResolvedValue({
      items: Array.from({ length: 25 }, (_, i) => item(i + 1)).reverse().sort(() => 0),
    });

    await newsCollectorProcessor(job);

    expect(createSignalMock).toHaveBeenCalledTimes(20);
    const urls = createSignalMock.mock.calls.map((call) => call[0].source_url);
    expect(urls).toContain("https://news.google.com/rss/articles/A25");
    expect(urls).not.toContain("https://news.google.com/rss/articles/A1");
  });

  it("accepts a plain-string <source> and items with no link are skipped", async () => {
    parseStringMock.mockResolvedValue({
      items: [item(1, { source: "Wire" }), item(2, { link: undefined })],
    });

    await newsCollectorProcessor(job);

    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(createSignalMock.mock.calls[0][0].raw_text).toContain("Publisher: Wire");
  });

  it("skips an own-company row with no news_query, but fetches one that has it", async () => {
    listCompetitorsMock.mockResolvedValue([
      { id: "own", name: "Us", news_query: null, is_active: true, is_own_company: true },
      { id: "own2", name: "Us", news_query: '"Us Inc"', is_active: true, is_own_company: true },
    ]);
    parseStringMock.mockResolvedValue({ items: [] });

    await newsCollectorProcessor(job);

    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(safeFetchMock.mock.calls[0][0]).searchParams.get("q")).toBe('"Us Inc" when:7d');
  });

  it("caps the headline at 300 characters", async () => {
    parseStringMock.mockResolvedValue({ items: [item(1, { title: "x".repeat(400) })] });

    await newsCollectorProcessor(job);

    expect(createSignalMock.mock.calls[0][0].title).toHaveLength(300);
  });

  it("charges the circuit when Google News answers non-2xx", async () => {
    safeFetchMock.mockResolvedValue({ ...ok, status: 503 });

    await newsCollectorProcessor(job);

    expect(recordFailure).toHaveBeenCalledWith("news", expect.stringContaining("503"));
  });
});
