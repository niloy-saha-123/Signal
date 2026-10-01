import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  isCircuitMarkedOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));
const q = vi.hoisted(() => ({
  listCompetitors: vi.fn(),
  signalExistsBySourceUrl: vi.fn(),
  createSignal: vi.fn(),
  getLatestWebsiteSnapshot: vi.fn(),
  createWebsiteSnapshot: vi.fn(),
  setCompetitorDocsSitemapUrl: vi.fn(),
}));
vi.mock("@/db/queries", () => q);
vi.mock("@/queues/registry", () => ({ registerWorker: vi.fn(), queues: {} }));
vi.mock("@/pipeline/recovery", () => ({ enqueueInitialSignalPipeline: vi.fn() }));
vi.mock("@/lib/retry", () => ({ withRetry: (fn: () => unknown) => fn() }));
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: safeFetchMock }));

import { recordFailure } from "@/reliability/circuit-breaker";
import { docsCollectorProcessor, parseSitemap, sitemapCandidates } from "@/collectors/docs";

const job = {} as any;
const res = (body: string, status = 200, url?: string) => ({
  status,
  url,
  headers: new Headers(),
  text: async () => body,
});
const urlset = (urls: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
    .map((u) => `<url><loc>${u}</loc></url>`)
    .join("")}</urlset>`;
const D = (p: string) => `https://docs.kestrel.dev${p}`;
const SITEMAP = D("/sitemap.xml");

function routes(map: Record<string, ReturnType<typeof res>>) {
  safeFetchMock.mockImplementation(async (url: string) => {
    if (url in map) return { ...map[url], url: map[url].url ?? url };
    throw new Error(`unexpected fetch ${url}`);
  });
}

const kestrel = (extra: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "Kestrel",
  domain: "kestrel.dev",
  docs_sitemap_url: SITEMAP,
  is_active: true,
  ...extra,
});

describe("parseSitemap / sitemapCandidates", () => {
  it("reads a urlset and a sitemap index", () => {
    expect(parseSitemap(urlset([D("/a")]))).toEqual({ kind: "urlset", locs: [D("/a")] });
    expect(
      parseSitemap(`<sitemapindex><sitemap><loc>${D("/s1.xml")}</loc></sitemap></sitemapindex>`)
    ).toEqual({ kind: "index", locs: [D("/s1.xml")] });
  });

  it("returns null for an HTML soft-404", () => {
    expect(parseSitemap("<!doctype html><html><body>Not found</body></html>")).toBeNull();
  });

  it("probes docs.<domain> then <domain> when nothing is configured", () => {
    expect(sitemapCandidates({ domain: "www.kestrel.dev", docs_sitemap_url: null })).toEqual([
      "https://docs.kestrel.dev/sitemap.xml",
      "https://kestrel.dev/sitemap.xml",
    ]);
    expect(sitemapCandidates({ domain: "kestrel.dev", docs_sitemap_url: SITEMAP })).toEqual([SITEMAP]);
    expect(sitemapCandidates({ domain: "https://evil/x", docs_sitemap_url: null })).toEqual([]);
  });
});

describe("docs collector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    q.signalExistsBySourceUrl.mockResolvedValue(false);
    q.createSignal.mockImplementation(async (s: any) => ({ id: s.source_url }));
  });

  it("baselines on first sight without emitting", async () => {
    q.listCompetitors.mockResolvedValue([kestrel()]);
    q.getLatestWebsiteSnapshot.mockResolvedValue(undefined);
    routes({ [SITEMAP]: res(urlset([D("/b"), D("/a")])) });

    await docsCollectorProcessor(job);

    expect(q.createSignal).not.toHaveBeenCalled();
    expect(q.createWebsiteSnapshot).toHaveBeenCalledWith({
      competitor_id: "c1",
      url: SITEMAP,
      content: `${D("/a")}\n${D("/b")}`,
    });
  });

  it("emits one signal per new page with its title and text", async () => {
    q.listCompetitors.mockResolvedValue([kestrel()]);
    q.getLatestWebsiteSnapshot.mockResolvedValue({ content: D("/a"), captured_at: new Date() });
    routes({
      [SITEMAP]: res(urlset([D("/a"), D("/agents")])),
      [D("/agents")]: res(
        "<html><head><title>Agents API</title></head><body><main>Build agents with Kestrel.</main></body></html>"
      ),
    });

    await docsCollectorProcessor(job);

    expect(q.createSignal).toHaveBeenCalledTimes(1);
    expect(q.createSignal.mock.calls[0][0]).toMatchObject({
      source: "docs",
      source_url: D("/agents"),
      title: "Agents API",
    });
    expect(q.createSignal.mock.calls[0][0].raw_text).toContain("Build agents with Kestrel.");
    expect(q.createWebsiteSnapshot).toHaveBeenCalledTimes(1);
  });

  it("collapses more than 10 new pages into one summary signal", async () => {
    q.listCompetitors.mockResolvedValue([kestrel()]);
    q.getLatestWebsiteSnapshot.mockResolvedValue({ content: D("/a"), captured_at: new Date() });
    const added = Array.from({ length: 30 }, (_, i) => D(`/fr/page-${i}`));
    routes({ [SITEMAP]: res(urlset([D("/a"), ...added])) });

    await docsCollectorProcessor(job);

    expect(q.createSignal).toHaveBeenCalledTimes(1);
    const summary = q.createSignal.mock.calls[0][0];
    expect(summary.source_url).toMatch(/^https:\/\/docs\.kestrel\.dev\/sitemap\.xml#\d{4}-\d{2}-\d{2}$/);
    expect(summary.title).toBe("30 new docs pages");
    expect(summary.raw_text.split("\n").filter((l: string) => l.startsWith("/fr/"))).toHaveLength(20);
  });

  it("probes, ignores an HTML soft-404, writes back the first real sitemap", async () => {
    q.listCompetitors.mockResolvedValue([kestrel({ docs_sitemap_url: null })]);
    q.getLatestWebsiteSnapshot.mockResolvedValue(undefined);
    routes({
      "https://docs.kestrel.dev/sitemap.xml": res("<html><body>Not found</body></html>"),
      "https://kestrel.dev/sitemap.xml": res(urlset(["https://kestrel.dev/docs/a"])),
    });

    await docsCollectorProcessor(job);

    expect(q.setCompetitorDocsSitemapUrl).toHaveBeenCalledWith("c1", "https://kestrel.dev/sitemap.xml");
  });

  it("skips quietly when no candidate is a sitemap", async () => {
    q.listCompetitors.mockResolvedValue([kestrel({ docs_sitemap_url: null })]);
    safeFetchMock.mockResolvedValue(res("", 404));

    await docsCollectorProcessor(job);

    expect(q.setCompetitorDocsSitemapUrl).not.toHaveBeenCalled();
    expect(q.createWebsiteSnapshot).not.toHaveBeenCalled();
  });

  it("follows a sitemap index but never off-host or gzipped children", async () => {
    q.listCompetitors.mockResolvedValue([kestrel()]);
    q.getLatestWebsiteSnapshot.mockResolvedValue(undefined);
    routes({
      [SITEMAP]: res(
        `<sitemapindex><sitemap><loc>${D("/s1.xml")}</loc></sitemap><sitemap><loc>https://cdn.other.com/s.xml</loc></sitemap><sitemap><loc>${D("/s2.xml.gz")}</loc></sitemap></sitemapindex>`
      ),
      [D("/s1.xml")]: res(urlset([D("/a"), "https://other.com/x"])),
    });

    await docsCollectorProcessor(job);

    const fetched = safeFetchMock.mock.calls.map((c) => c[0]);
    expect(fetched).toEqual([SITEMAP, D("/s1.xml")]);
    expect(q.createWebsiteSnapshot.mock.calls[0][0].content).toBe(D("/a"));
  });

  it("filters by the root sitemap's final host after an apex-to-www redirect", async () => {
    q.listCompetitors.mockResolvedValue([kestrel({ docs_sitemap_url: null })]);
    q.getLatestWebsiteSnapshot.mockResolvedValue(undefined);
    routes({
      "https://docs.kestrel.dev/sitemap.xml": res("", 404),
      "https://kestrel.dev/sitemap.xml": res(
        urlset(["https://www.kestrel.dev/docs/a"]),
        200,
        "https://www.kestrel.dev/sitemap.xml"
      ),
    });

    await docsCollectorProcessor(job);

    expect(q.createWebsiteSnapshot.mock.calls[0][0].content).toBe("https://www.kestrel.dev/docs/a");
  });

  it("treats a sitemap whose locs are all off-host as not found", async () => {
    q.listCompetitors.mockResolvedValue([kestrel({ docs_sitemap_url: null })]);
    routes({
      "https://docs.kestrel.dev/sitemap.xml": res(urlset(["https://other.com/x"])),
      "https://kestrel.dev/sitemap.xml": res("", 404),
    });

    await docsCollectorProcessor(job);

    expect(q.setCompetitorDocsSitemapUrl).not.toHaveBeenCalled();
    expect(q.createWebsiteSnapshot).not.toHaveBeenCalled();
  });

  it("fails the run instead of falling back to the apex when docs.<domain> returns 5xx", async () => {
    q.listCompetitors.mockResolvedValue([kestrel({ docs_sitemap_url: null })]);
    routes({
      "https://docs.kestrel.dev/sitemap.xml": res("", 503),
      "https://kestrel.dev/sitemap.xml": res(urlset(["https://kestrel.dev/docs/a"])),
    });

    await docsCollectorProcessor(job);

    expect(recordFailure).toHaveBeenCalled();
    expect(q.setCompetitorDocsSitemapUrl).not.toHaveBeenCalled();
    expect(safeFetchMock.mock.calls.map((c) => c[0])).toEqual(["https://docs.kestrel.dev/sitemap.xml"]);
  });

  it("falls through to the apex when docs.<domain> returns 404", async () => {
    q.listCompetitors.mockResolvedValue([kestrel({ docs_sitemap_url: null })]);
    q.getLatestWebsiteSnapshot.mockResolvedValue(undefined);
    routes({
      "https://docs.kestrel.dev/sitemap.xml": res("", 404),
      "https://kestrel.dev/sitemap.xml": res(urlset(["https://kestrel.dev/docs/a"])),
    });

    await docsCollectorProcessor(job);

    expect(q.setCompetitorDocsSitemapUrl).toHaveBeenCalledWith("c1", "https://kestrel.dev/sitemap.xml");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("skips diffing and the snapshot when a sitemap-index child is not a urlset", async () => {
    q.listCompetitors.mockResolvedValue([kestrel()]);
    q.getLatestWebsiteSnapshot.mockResolvedValue({ content: D("/a"), captured_at: new Date() });
    routes({
      [SITEMAP]: res(
        `<sitemapindex><sitemap><loc>${D("/s1.xml")}</loc></sitemap><sitemap><loc>${D("/s2.xml")}</loc></sitemap></sitemapindex>`
      ),
      [D("/s1.xml")]: res(urlset([D("/a"), D("/b")])),
      [D("/s2.xml")]: res("<html><body>oops</body></html>"),
      [D("/b")]: res("<html><head><title>B</title></head><body><main>B page.</main></body></html>"),
    });

    await docsCollectorProcessor(job);

    expect(q.createSignal).not.toHaveBeenCalled();
    expect(q.createWebsiteSnapshot).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("does not probe an own-company row with no configured sitemap", async () => {
    q.listCompetitors.mockResolvedValue([kestrel({ docs_sitemap_url: null, is_own_company: true })]);

    await docsCollectorProcessor(job);

    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("skips a page that fails to fetch and still saves the new snapshot", async () => {
    q.listCompetitors.mockResolvedValue([kestrel()]);
    q.getLatestWebsiteSnapshot.mockResolvedValue({ content: D("/a"), captured_at: new Date() });
    routes({ [SITEMAP]: res(urlset([D("/a"), D("/b")])), [D("/b")]: res("", 500) });

    await docsCollectorProcessor(job);

    expect(q.createSignal).not.toHaveBeenCalled();
    expect(q.createWebsiteSnapshot).toHaveBeenCalledTimes(1);
  });
});
