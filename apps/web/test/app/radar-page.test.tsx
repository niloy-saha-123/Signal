import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { Competitor } from "../../lib/api";

const {
  getCompetitorMock,
  getCompetitorScoreMock,
  getCompetitorScoreHistoryMock,
  getCompetitorTrendMock,
  getCompetitorHiringMock,
} = vi.hoisted(() => ({
  getCompetitorMock: vi.fn(),
  getCompetitorScoreMock: vi.fn(),
  getCompetitorScoreHistoryMock: vi.fn(),
  getCompetitorTrendMock: vi.fn(),
  getCompetitorHiringMock: vi.fn(),
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
  };
});

vi.mock("../../lib/supabase-server", () => ({
  getServerAccessToken: vi.fn().mockResolvedValue(undefined),
  getOptionalAccessToken: vi.fn().mockResolvedValue(undefined),
}));

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

import Page from "../../app/(app)/radar/[id]/page";

const competitor: Competitor = {
  id: "comp-1",
  name: "Acme",
  domain: "acme.com",
  subreddits: [],
  greenhouse_token: null,
  lever_token: null,
  pricing_url: null,
  changelog_rss: null,
  is_active: true,
  is_own_company: false,
  discovery_status: "complete",
  discovered_at: "2026-09-14T00:00:00.000Z",
  created_at: "2026-09-14T00:00:00.000Z",
  updated_at: "2026-09-14T00:00:00.000Z",
};

describe("Radar page", () => {
  afterEach(() => {
    getCompetitorMock.mockReset();
    getCompetitorScoreMock.mockReset();
    getCompetitorScoreHistoryMock.mockReset();
    getCompetitorTrendMock.mockReset();
    getCompetitorHiringMock.mockReset();
  });

  it("passes real trend and hiring data to the charts instead of empty arrays", async () => {
    getCompetitorMock.mockResolvedValue(competitor);
    getCompetitorScoreMock.mockResolvedValue({
      score: 72,
      components: {},
      computed_at: "2026-09-14T00:00:00.000Z",
      delta_7d: 1,
      delta_30d: 2,
    });
    getCompetitorScoreHistoryMock.mockResolvedValue([]);
    const trend = [{ date: "2026-09-01", mention_volume: 5, sentiment: -0.2, score: 60 }];
    const hiring = [{ department: "Engineering", delta: 3 }];
    getCompetitorTrendMock.mockResolvedValue(trend);
    getCompetitorHiringMock.mockResolvedValue(hiring);

    const jsx = await Page({ params: Promise.resolve({ id: "comp-1" }) });
    render(jsx);

    expect(getCompetitorTrendMock).toHaveBeenCalledWith("comp-1", 30, undefined);
    expect(getCompetitorHiringMock).toHaveBeenCalledWith("comp-1", 30, undefined);
    expect(screen.getByTestId("trend-chart")).toHaveTextContent(JSON.stringify(trend));
    expect(screen.getByTestId("hiring-chart")).toHaveTextContent(JSON.stringify(hiring));
  });

  it("degrades to empty arrays (not a crash) when the trend/hiring fetches fail", async () => {
    getCompetitorMock.mockResolvedValue(competitor);
    getCompetitorScoreMock.mockResolvedValue(null);
    getCompetitorScoreHistoryMock.mockResolvedValue([]);
    getCompetitorTrendMock.mockRejectedValue(new Error("api down"));
    getCompetitorHiringMock.mockRejectedValue(new Error("api down"));

    const jsx = await Page({ params: Promise.resolve({ id: "comp-1" }) });
    render(jsx);

    expect(screen.getByTestId("trend-chart")).toHaveTextContent("[]");
    expect(screen.getByTestId("hiring-chart")).toHaveTextContent("[]");
  });
});
