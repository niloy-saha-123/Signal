import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listCompetitorsMock,
  getCompetitorScoreMock,
  listAlertsMock,
  getDashboardSummaryMock,
  getOptionalAccessTokenMock,
  listPredictionsMock,
} = vi.hoisted(() => ({
  listPredictionsMock: vi.fn(),
  listCompetitorsMock: vi.fn(),
  getCompetitorScoreMock: vi.fn(),
  listAlertsMock: vi.fn(),
  getDashboardSummaryMock: vi.fn(),
  getOptionalAccessTokenMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  getServerAccessToken: getOptionalAccessTokenMock,
  getOptionalAccessToken: getOptionalAccessTokenMock,
}));

vi.mock("@/lib/api", () => ({
  listCompetitors: listCompetitorsMock,
  getCompetitorScore: getCompetitorScoreMock,
  listAlerts: listAlertsMock,
  getDashboardSummary: getDashboardSummaryMock,
  listPredictions: listPredictionsMock,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import BriefingPage from "../../app/(app)/briefing/page";

describe("BriefingPage", () => {
  beforeEach(() => {
    listCompetitorsMock.mockReset();
    getCompetitorScoreMock.mockReset();
    listAlertsMock.mockReset();
    getDashboardSummaryMock.mockReset();
    getOptionalAccessTokenMock.mockReset();
    getOptionalAccessTokenMock.mockResolvedValue("server-token");
    getDashboardSummaryMock.mockResolvedValue({
      competitors_tracked: 0,
      signals_this_week: 0,
      open_alerts: 0,
      pending_candidates: 0,
    });
  });

  it("renders the new-workspace empty state with an inline add, without requesting alerts or scores", async () => {
    listCompetitorsMock.mockResolvedValue([]);

    render(await BriefingPage());

    expect(screen.getByRole("heading", { name: "Your briefing starts with a competitor." })).toBeInTheDocument();
    expect(screen.getByLabelText("Competitor website")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Let Signal suggest competitors" })).toHaveAttribute("href", "/discovery");
    expect(getCompetitorScoreMock).not.toHaveBeenCalled();
    expect(listAlertsMock).not.toHaveBeenCalled();
  });

  it("treats a workspace with only its own company as empty", async () => {
    listCompetitorsMock.mockResolvedValue([{ id: "own", name: "Us", is_own_company: true, is_active: true }]);
    render(await BriefingPage());
    expect(screen.getByRole("heading", { name: "Your briefing starts with a competitor." })).toBeInTheDocument();
  });

  it("shows movements, the soonest forecasts and the pulse for a live workspace", async () => {
    listCompetitorsMock.mockResolvedValue([{ id: "k", name: "Kestrel", is_own_company: false, is_active: true }]);
    getCompetitorScoreMock.mockResolvedValue({ score: 64, delta_7d: 5 });
    listAlertsMock.mockResolvedValue({
      data: [
        {
          id: "a1",
          competitor_id: "k",
          pattern: "pricing_change",
          interpretation: "Kestrel split its pricing.",
          confidence: 0.8,
          created_at: "2026-09-30T10:00:00.000Z",
          recommended_actions: [{ action: "Review your Team tier." }],
        },
      ],
      next_cursor: null,
    });
    listPredictionsMock.mockResolvedValue([
      { id: "p2", competitor_id: "k", statement: "Later one", probability: 0.4, resolves_at: "2026-12-30T00:00:00.000Z" },
      { id: "p1", competitor_id: "k", statement: "Sooner one", probability: 0.72, resolves_at: "2026-11-01T00:00:00.000Z" },
    ]);

    render(await BriefingPage());

    expect(screen.getByRole("heading", { name: "1 thing moved." })).toBeInTheDocument();
    expect(screen.getByText("Review your Team tier.")).toBeInTheDocument();
    const forecastLinks = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/forecast/"));
    expect(forecastLinks.map((a) => a.getAttribute("href"))).toEqual(["/forecast/p1", "/forecast/p2"]);
    expect(screen.getByText("Up 5 this week")).toBeInTheDocument();
  });

  it("still renders when forecasts fail to load", async () => {
    listCompetitorsMock.mockResolvedValue([{ id: "k", name: "Kestrel", is_own_company: false, is_active: true }]);
    getCompetitorScoreMock.mockRejectedValue(new Error("down"));
    listAlertsMock.mockResolvedValue({ data: [], next_cursor: null });
    listPredictionsMock.mockRejectedValue(new Error("down"));

    render(await BriefingPage());

    expect(screen.getByRole("heading", { name: "Quiet out there." })).toBeInTheDocument();
    expect(screen.getByText("No forecasts yet")).toBeInTheDocument();
  });

  it("renders the preview briefing without fabricated forecasts when there is no session", async () => {
    getOptionalAccessTokenMock.mockResolvedValue(undefined);

    render(await BriefingPage());

    expect(screen.getByRole("heading", { name: "3 things moved." })).toBeInTheDocument();
    expect(screen.getByText("No forecasts yet")).toBeInTheDocument();
    expect(listCompetitorsMock).not.toHaveBeenCalled();
  });
});
