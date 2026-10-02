import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from "@/lib/logger";
import {
  coverageFor,
  loadCompetitorProfile,
  type CompetitorProfileDeps,
} from "@/api/competitor-profile";

const ID = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-02T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const ORDER = [
  "website",
  "pricing",
  "changelog",
  "jobs",
  "reddit",
  "hn",
  "github",
  "community",
  "postings",
  "news",
  "docs",
  "packages",
  "blog",
  "social",
];

function competitor(over: Record<string, unknown> = {}): any {
  return {
    id: ID,
    workspace_id: WS,
    website_urls: [],
    subreddits: [],
    npm_packages: [],
    pypi_packages: [],
    blog_feeds: [],
    social_feeds: [],
    forum_feeds: [],
    pricing_url: null,
    changelog_rss: null,
    greenhouse_token: null,
    lever_token: null,
    github_org: null,
    discourse_url: null,
    stackoverflow_tag: null,
    postings_rss: null,
    news_query: null,
    docs_sitemap_url: null,
    bluesky_handle: null,
    is_own_company: false,
    discovery_status: "pending",
    ...over,
  };
}

const stateOf = (rows: { source: string; state: string }[], source: string) =>
  rows.find((r) => r.source === source)?.state;

describe("coverageFor", () => {
  it("marks hn/news Watching and the rest Looking while discovery is pending", () => {
    const rows = coverageFor(competitor(), []);
    expect(rows.map((r) => r.source)).toEqual(ORDER);
    expect(rows.filter((r) => r.state === "Watching").map((r) => r.source)).toEqual(["hn", "news"]);
    expect(rows.filter((r) => r.state !== "Watching").every((r) => r.state === "Looking")).toBe(true);
  });

  it("marks unconfigured sources Not found once discovery is complete", () => {
    const rows = coverageFor(competitor({ discovery_status: "complete" }), []);
    expect(rows.filter((r) => r.state !== "Watching").every((r) => r.state === "Not found")).toBe(true);
    expect(rows.filter((r) => r.state === "Watching")).toHaveLength(2);
  });

  it.each([
    ["website", { website_urls: ["https://x.test/"] }],
    ["pricing", { pricing_url: "https://x.test/pricing" }],
    ["changelog", { changelog_rss: "https://x.test/rss" }],
    ["jobs", { greenhouse_token: "gh" }],
    ["jobs", { lever_token: "lv" }],
    ["reddit", { subreddits: ["x"] }],
    ["github", { github_org: "x" }],
    ["community", { discourse_url: "https://d.test" }],
    ["community", { forum_feeds: ["https://f.test/rss"] }],
    ["community", { stackoverflow_tag: "x" }],
    ["postings", { postings_rss: "https://p.test/rss" }],
    ["news", { is_own_company: true, news_query: "x" }],
    ["docs", { docs_sitemap_url: "https://x.test/sitemap.xml" }],
    ["packages", { npm_packages: ["x"] }],
    ["packages", { pypi_packages: ["x"] }],
    ["blog", { blog_feeds: ["https://b.test/rss"] }],
    ["social", { social_feeds: ["https://s.test/rss"] }],
    ["social", { bluesky_handle: "x.bsky.social" }],
  ])("%s becomes Watching when configured via %j", (source, over) => {
    const base = competitor({ discovery_status: "complete", ...(source === "news" ? { is_own_company: true } : {}) });
    expect(stateOf(coverageFor(base, []), source)).not.toBe("Watching");
    expect(stateOf(coverageFor({ ...base, ...over }, []), source)).toBe("Watching");
  });

  it("own company without news_query does not watch news", () => {
    expect(stateOf(coverageFor(competitor({ is_own_company: true }), []), "news")).toBe("Looking");
  });

  it("a reddit signal is Reporting even when unconfigured", () => {
    expect(stateOf(coverageFor(competitor(), [{ source: "reddit" }]), "reddit")).toBe("Reporting");
  });

  it("appends a field signal as Reporting at the end", () => {
    const rows = coverageFor(competitor(), [{ source: "field" }]);
    expect(rows).toHaveLength(15);
    expect(rows[14]).toEqual({ source: "field", state: "Reporting" });
  });
});

function scoreRow(daysAgo: number, over: Record<string, unknown> = {}): any {
  return {
    id: `s${daysAgo}`,
    competitor_id: ID,
    score: 50 - daysAgo,
    components: {
      mention_velocity: 0.1,
      sentiment_trajectory: 0.3,
      hiring_momentum: 0,
      pricing_change_recency: 0,
      vulnerability_window_status: "none",
    },
    delta_7d: 1,
    delta_30d: null,
    computed_at: new Date(NOW - daysAgo * DAY),
    ...over,
  };
}

function makeDeps(over: Partial<CompetitorProfileDeps> = {}): CompetitorProfileDeps {
  return {
    getCompetitorByIdForWorkspace: vi.fn(async () => competitor()) as any,
    getLatestSignalScores: vi.fn(async () => []) as any,
    getSignalVolumeByDay: vi.fn(async () => []) as any,
    getJobSignalsForHiringDelta: vi.fn(async () => []) as any,
    listPredictionsForWorkspace: vi.fn(async () => []) as any,
    listSignalFeed: vi.fn(async () => []) as any,
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("loadCompetitorProfile", () => {
  it("returns null when the competitor is not in the workspace", async () => {
    const deps = makeDeps({ getCompetitorByIdForWorkspace: vi.fn(async () => undefined) as any });
    expect(await loadCompetitorProfile(WS, ID, deps, NOW)).toBeNull();
    expect(deps.getCompetitorByIdForWorkspace).toHaveBeenCalledWith(ID, WS);
  });

  it("returns the full shape when every dep resolves", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => scoreRow(i));
    const day = new Date(NOW).toISOString().slice(0, 10);
    const deps = makeDeps({
      getLatestSignalScores: vi.fn(async () => rows) as any,
      getSignalVolumeByDay: vi.fn(async () => [{ day, count: 7 }]) as any,
      getJobSignalsForHiringDelta: vi.fn(async () => [
        { title: "Senior Software Engineer", created_at: new Date(NOW - DAY) },
      ]) as any,
      listSignalFeed: vi.fn(async () => [{ source: "reddit" }]) as any,
    });

    const p = await loadCompetitorProfile(WS, ID, deps, NOW);

    expect(deps.getLatestSignalScores).toHaveBeenCalledWith(ID, 90);
    expect(deps.getSignalVolumeByDay).toHaveBeenCalledWith(ID, 30);
    expect(deps.getJobSignalsForHiringDelta).toHaveBeenCalledWith(ID, 30);
    expect(p!.score).toMatchObject({ score: 50, delta_7d: 1, delta_30d: null });
    expect(p!.history).toHaveLength(40);
    expect(p!.history[39]).toEqual({ date: new Date(NOW).toISOString(), score: 50 });
    expect(p!.history[0].score).toBe(50 - 39);
    expect(p!.trend).toHaveLength(30);
    expect(p!.trend[29]).toEqual({ date: day, mention_volume: 7, sentiment: 0.3, score: 50 });
    expect(p!.hiring).toEqual([{ department: "Engineering", delta: 1 }]);
    expect(stateOf(p!.coverage, "reddit")).toBe("Reporting");
    expect(p!.signals).toEqual([{ source: "reddit" }]);
  });

  it("returns a null score and empty arrays when there are no score rows", async () => {
    const p = await loadCompetitorProfile(WS, ID, makeDeps(), NOW);
    expect(p).toMatchObject({ score: null, history: [], trend: [], hiring: [], forecasts: [], signals: [] });
  });

  it("falls back to [] and logs when a sub-query rejects, leaving the rest intact", async () => {
    const deps = makeDeps({
      getLatestSignalScores: vi.fn(async () => [scoreRow(0)]) as any,
      getJobSignalsForHiringDelta: vi.fn(async () => {
        throw new Error("boom");
      }) as any,
    });
    const p = await loadCompetitorProfile(WS, ID, deps, NOW);
    expect(p!.hiring).toEqual([]);
    expect(p!.score).toMatchObject({ score: 50 });
    expect(logger.warn).toHaveBeenCalledWith(
      "competitor profile: hiring failed",
      expect.objectContaining({ competitor_id: ID })
    );
  });

  it("queries open forecasts and sorts them by resolves_at ascending", async () => {
    const later = { id: "b", resolves_at: new Date(NOW + 5 * DAY) };
    const sooner = { id: "a", resolves_at: new Date(NOW + DAY) };
    const deps = makeDeps({ listPredictionsForWorkspace: vi.fn(async () => [later, sooner]) as any });
    const p = await loadCompetitorProfile(WS, ID, deps, NOW);
    expect(deps.listPredictionsForWorkspace).toHaveBeenCalledWith({
      workspace_id: WS,
      competitor_id: ID,
      status: "open",
      limit: 20,
    });
    expect(p!.forecasts.map((f: any) => f.id)).toEqual(["a", "b"]);
  });

  it("trims the feed's pagination sentinel row so at most 50 signals come back", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      source: i === 50 ? "docs" : "reddit",
    }));
    const deps = makeDeps({ listSignalFeed: vi.fn(async () => rows) as any });
    const p = await loadCompetitorProfile(WS, ID, deps, NOW);
    expect(p!.signals).toHaveLength(50);
    expect(stateOf(p!.coverage, "docs")).not.toBe("Reporting");
  });

  it("queries the last 30 days of signals, capped at 50", async () => {
    const deps = makeDeps();
    await loadCompetitorProfile(WS, ID, deps, NOW);
    expect(deps.listSignalFeed).toHaveBeenCalledWith({
      workspace_id: WS,
      competitor_ids: [ID],
      created_after: new Date(NOW - 30 * DAY),
      limit: 50,
    });
  });
});
