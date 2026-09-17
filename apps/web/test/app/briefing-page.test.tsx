import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listCompetitorsMock,
  getCompetitorScoreMock,
  listAlertsMock,
  getDashboardSummaryMock,
  getOptionalAccessTokenMock,
} = vi.hoisted(() => ({
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
}));

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

  it("renders the new-workspace empty state without requesting alerts or scores", async () => {
    listCompetitorsMock.mockResolvedValue([]);

    render(await BriefingPage());

    expect(
      screen.getByRole("heading", { name: "Your briefing starts with a competitor." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add your first competitor" })).toHaveAttribute(
      "href",
      "/discovery",
    );
    expect(getCompetitorScoreMock).not.toHaveBeenCalled();
    expect(listAlertsMock).not.toHaveBeenCalled();
  });

  it("renders the preview briefing when there is no session", async () => {
    getOptionalAccessTokenMock.mockResolvedValue(undefined);

    render(await BriefingPage());

    expect(screen.getByRole("heading", { name: "Overnight briefing" })).toBeInTheDocument();
    expect(screen.getByText("Highest-signal movement")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(listCompetitorsMock).not.toHaveBeenCalled();
  });
});
