import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import type { Signal } from "@signal/shared";
import type { Competitor, PredictionRow } from "../../lib/api";

const {
  getCompetitorMock,
  getCompetitorScoreMock,
  getCompetitorScoreHistoryMock,
  getCompetitorTrendMock,
  getCompetitorHiringMock,
  listPredictionsMock,
  listSignalsMock,
  tokenMock,
} = vi.hoisted(() => ({
  getCompetitorMock: vi.fn(),
  getCompetitorScoreMock: vi.fn(),
  getCompetitorScoreHistoryMock: vi.fn(),
  getCompetitorTrendMock: vi.fn(),
  getCompetitorHiringMock: vi.fn(),
  listPredictionsMock: vi.fn(),
  listSignalsMock: vi.fn(),
  tokenMock: vi.fn(),
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    getCompetitor: getCompetitorMock,
    getCompetitorScore: getCompetitorScoreMock,
    getCompetitorScoreHistory: getCompetitorScoreHistoryMock,
    getCompetitorTrend: getCompetitorTrendMock,
    getCompetitorHiring: getCompetitorHiringMock,
    listPredictions: listPredictionsMock,
    listSignals: listSignalsMock,
  };
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

function happyPath() {
  getCompetitorMock.mockResolvedValue(competitor);
  getCompetitorScoreMock.mockResolvedValue({
    score: 72,
    components: {},
    computed_at: "2026-09-14T00:00:00.000Z",
    delta_7d: 1,
    delta_30d: 2,
  });
  getCompetitorScoreHistoryMock.mockResolvedValue([]);
  getCompetitorTrendMock.mockResolvedValue([]);
  getCompetitorHiringMock.mockResolvedValue([]);
  listPredictionsMock.mockResolvedValue([prediction]);
  listSignalsMock.mockResolvedValue({
    data: [
      signal("s1", "pricing", "Enterprise plan appears"),
      signal("s2", "pricing", "Annual discount removed"),
      signal("s3", "jobs", "Three solutions engineers"),
    ],
    next_cursor: null,
  });
}

describe("Competitor profile page", () => {
  beforeEach(() => {
    tokenMock.mockResolvedValue("tok");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes real trend and hiring data to the charts instead of empty arrays", async () => {
    happyPath();
    const trend = [{ date: "2026-09-01", mention_volume: 5, sentiment: -0.2, score: 60 }];
    const hiring = [{ department: "Engineering", delta: 3 }];
    getCompetitorTrendMock.mockResolvedValue(trend);
    getCompetitorHiringMock.mockResolvedValue(hiring);

    render(await Page({ params: Promise.resolve({ id: "comp-1" }) }));

    expect(getCompetitorTrendMock).toHaveBeenCalledWith("comp-1", 30, "tok");
    expect(getCompetitorHiringMock).toHaveBeenCalledWith("comp-1", 30, "tok");
    expect(screen.getByTestId("trend-chart")).toHaveTextContent(JSON.stringify(trend));
    expect(screen.getByTestId("hiring-chart")).toHaveTextContent(JSON.stringify(hiring));
  });

  it("degrades to empty panels (not a crash) when secondary fetches fail", async () => {
    happyPath();
    getCompetitorScoreMock.mockRejectedValue(new Error("api down"));
    getCompetitorTrendMock.mockRejectedValue(new Error("api down"));
    getCompetitorHiringMock.mockRejectedValue(new Error("api down"));
    listPredictionsMock.mockRejectedValue(new Error("api down"));
    listSignalsMock.mockRejectedValue(new Error("api down"));

    render(await Page({ params: Promise.resolve({ id: "comp-1" }) }));

    expect(screen.getByText("No activity score yet")).toBeInTheDocument();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
    expect(screen.queryByTestId("hiring-chart")).toBeNull();
    expect(screen.getByText("No trend yet")).toBeInTheDocument();
    expect(screen.getByText("No hiring changes in the last 30 days")).toBeInTheDocument();
    expect(screen.getByText("No evidence in the last 30 days")).toBeInTheDocument();
    expect(screen.getByText("No open forecasts for Acme")).toBeInTheDocument();
  });

  it("lists this competitor's open forecasts", async () => {
    happyPath();
    render(await Page({ params: Promise.resolve({ id: "comp-1" }) }));
    expect(listPredictionsMock).toHaveBeenCalledWith({ competitor_id: "comp-1", status: "open", limit: 20 }, "tok");
    expect(screen.getByRole("link", { name: /Acme ships SSO for every plan/ })).toHaveAttribute("href", "/forecast/pred-1");
  });

  it("groups recent evidence by source with counts", async () => {
    happyPath();
    render(await Page({ params: Promise.resolve({ id: "comp-1" }) }));
    const evidence = screen.getByRole("region", { name: "Recent evidence" });
    expect(within(evidence).getByRole("button", { name: /Pricing 2/ })).toBeInTheDocument();
    expect(within(evidence).getByRole("button", { name: /Jobs 1/ })).toBeInTheDocument();
    expect(within(evidence).getByText("Enterprise plan appears")).toBeInTheDocument();
  });

  it("shows which sources are configured and which reported recently", async () => {
    happyPath();
    render(await Page({ params: Promise.resolve({ id: "comp-1" }) }));
    const coverage = screen.getByRole("region", { name: "Sources" });
    expect(within(coverage).getByText("Pricing").closest("li")).toHaveTextContent("Reporting");
    expect(within(coverage).getByText("Reddit").closest("li")).toHaveTextContent("Watching");
    expect(within(coverage).getByText("Changelog").closest("li")).toHaveTextContent("Not found");
  });

  it("shows live discovery progress while sources are still being found", async () => {
    happyPath();
    getCompetitorMock.mockResolvedValue({ ...competitor, discovery_status: "in_progress" });
    render(await Page({ params: Promise.resolve({ id: "comp-1" }) }));
    expect(screen.getByTestId("discovery-status")).toHaveTextContent("comp-1");
  });

  it("renders the fictional preview profile without a session, with no forecasts", async () => {
    tokenMock.mockResolvedValue(undefined);
    render(await Page({ params: Promise.resolve({ id: PREVIEW_NORTHSTAR_ID }) }));
    expect(getCompetitorMock).not.toHaveBeenCalled();
    expect(listPredictionsMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Northstar" })).toBeInTheDocument();
    expect(screen.getByText("Enterprise plan split from self-serve")).toBeInTheDocument();
    expect(screen.getByText("No open forecasts for Northstar")).toBeInTheDocument();
  });
});
