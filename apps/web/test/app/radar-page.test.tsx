import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import type { Signal } from "@signal/shared";
import { ApiError, type Competitor, type CompetitorProfile, type PredictionRow } from "../../lib/api";

const { getCompetitorProfileMock, tokenMock } = vi.hoisted(() => ({
  getCompetitorProfileMock: vi.fn(),
  tokenMock: vi.fn(),
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, getCompetitorProfile: getCompetitorProfileMock };
});

vi.mock("../../lib/supabase-server", () => ({
  getServerAccessToken: tokenMock,
  getOptionalAccessToken: tokenMock,
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...actual, useRouter: () => ({ refresh: vi.fn() }) };
});

vi.mock("../../components/TrendChart", () => ({
  TrendChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="trend-chart">{JSON.stringify(data)}</div>
  ),
}));

vi.mock("../../components/HiringChart", () => ({
  HiringChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="hiring-chart">{JSON.stringify(data)}</div>
  ),
}));

vi.mock("../../components/DiscoveryStatus", () => ({
  DiscoveryStatus: ({ competitorId }: { competitorId: string }) => (
    <div data-testid="discovery-status">{competitorId}</div>
  ),
}));

import Page from "../../app/(app)/radar/[id]/page";
import { PREVIEW_NORTHSTAR_ID } from "../../lib/preview-workspace";

const competitor: Competitor = {
  id: "comp-1",
  name: "Acme",
  domain: "acme.com",
  subreddits: ["acme"],
  greenhouse_token: "acme",
  lever_token: null,
  pricing_url: "https://acme.com/pricing",
  changelog_rss: null,
  is_active: true,
  is_own_company: false,
  discovery_status: "complete",
  discovered_at: "2026-09-14T00:00:00.000Z",
  created_at: "2026-09-14T00:00:00.000Z",
  updated_at: "2026-09-14T00:00:00.000Z",
};

function signal(id: string, source: Signal["source"], title: string): Signal {
  return {
    id,
    competitor_id: "11111111-1111-4111-8111-000000000001",
    source,
    source_url: `https://acme.com/${id}`,
    title,
    raw_text: `${title} body`,
    quality_score: 0.8,
    entities: {},
    cluster_id: null,
    collected_at: "2026-09-20T00:00:00.000Z",
    created_at: "2026-09-20T00:00:00.000Z",
  };
}

const prediction = {
  id: "pred-1",
  competitor_id: "comp-1",
  pattern_type: "enterprise_push",
  statement: "Acme ships SSO for every plan",
  probability: 0.7,
  status: "open",
  resolves_at: "2026-12-01T00:00:00.000Z",
  created_at: "2026-09-01T00:00:00.000Z",
  resolved_at: null,
  resolution_note: null,
  evidence_count: 4,
} as unknown as PredictionRow;

const coverage: CompetitorProfile["coverage"] = [
  { source: "pricing", state: "Reporting" },
  { source: "reddit", state: "Watching" },
  { source: "changelog", state: "Not found" },
  { source: "blog", state: "Watching" },
];

function happyPath(overrides: Partial<CompetitorProfile> = {}) {
  getCompetitorProfileMock.mockResolvedValue({
    competitor,
    score: { score: 72, components: {}, computed_at: "2026-09-14T00:00:00.000Z", delta_7d: 1, delta_30d: 2 },
    history: [],
    trend: [],
    hiring: [],
    forecasts: [prediction],
    signals: [
      signal("s1", "pricing", "Enterprise plan appears"),
      signal("s2", "pricing", "Annual discount removed"),
      signal("s3", "jobs", "Three solutions engineers"),
    ],
    coverage,
    ...overrides,
  });
}

const render_ = async (id = "comp-1") => render(await Page({ params: Promise.resolve({ id }) }));

describe("Competitor profile page", () => {
  beforeEach(() => {
    tokenMock.mockResolvedValue("tok");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads the whole profile in one call and renders name, score and an open forecast", async () => {
    happyPath();
    await render_();
    expect(getCompetitorProfileMock).toHaveBeenCalledTimes(1);
    expect(getCompetitorProfileMock).toHaveBeenCalledWith("comp-1", "tok");
    expect(screen.getByRole("heading", { level: 1, name: "Acme" })).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acme ships SSO for every plan/ })).toHaveAttribute(
      "href",
      "/forecast/pred-1"
    );
  });

  it("passes real trend and hiring data to the charts", async () => {
    const trend = [{ date: "2026-09-01", mention_volume: 5, sentiment: -0.2, score: 60 }];
    const hiring = [{ department: "Engineering", delta: 3 }];
    happyPath({ trend, hiring });
    await render_();
    expect(screen.getByTestId("trend-chart")).toHaveTextContent(JSON.stringify(trend));
    expect(screen.getByTestId("hiring-chart")).toHaveTextContent(JSON.stringify(hiring));
  });

  it("renders designed empty panels for an empty profile", async () => {
    happyPath({ score: null, forecasts: [], signals: [], trend: [], hiring: [] });
    await render_();
    expect(screen.getByText("No activity score yet")).toBeInTheDocument();
    expect(screen.getByText("No trend yet")).toBeInTheDocument();
    expect(screen.getByText("No hiring changes in the last 30 days")).toBeInTheDocument();
    expect(screen.getByText("No evidence in the last 30 days")).toBeInTheDocument();
    expect(screen.getByText("No open forecasts for Acme")).toBeInTheDocument();
  });

  it("groups recent evidence by source with counts", async () => {
    happyPath();
    await render_();
    const evidence = screen.getByRole("region", { name: "Recent evidence" });
    expect(within(evidence).getByRole("button", { name: /Pricing 2/ })).toBeInTheDocument();
    expect(within(evidence).getByRole("button", { name: /Jobs 1/ })).toBeInTheDocument();
    expect(within(evidence).getByText("Enterprise plan appears")).toBeInTheDocument();
  });

  it("renders the server's coverage rows, including sources the browser never covered", async () => {
    happyPath();
    await render_();
    const sources = screen.getByRole("region", { name: "Sources" });
    expect(within(sources).getByText("Pricing").closest("li")).toHaveTextContent("Reporting");
    expect(within(sources).getByText("Reddit").closest("li")).toHaveTextContent("Watching");
    expect(within(sources).getByText("Changelog").closest("li")).toHaveTextContent("Not found");
    expect(within(sources).getByText("Blog").closest("li")).toHaveTextContent("Watching");
  });

  it("shows live discovery progress while sources are still being found", async () => {
    happyPath({ competitor: { ...competitor, discovery_status: "in_progress" } });
    await render_();
    expect(screen.getByTestId("discovery-status")).toHaveTextContent("comp-1");
  });

  it("404s when the API says the competitor does not exist", async () => {
    getCompetitorProfileMock.mockRejectedValue(new ApiError(404, undefined));
    await expect(Page({ params: Promise.resolve({ id: "nope" }) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("renders the fictional preview profile without a session, with no forecasts", async () => {
    tokenMock.mockResolvedValue(undefined);
    await render_(PREVIEW_NORTHSTAR_ID);
    expect(getCompetitorProfileMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Northstar" })).toBeInTheDocument();
    expect(screen.getByText("Enterprise plan split from self-serve")).toBeInTheDocument();
    expect(screen.getByText("No open forecasts for Northstar")).toBeInTheDocument();
  });
});
