import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listCompetitorsMock, getCompetitorScoreMock, listAlertsMock } = vi.hoisted(() => ({
  listCompetitorsMock: vi.fn(),
  getCompetitorScoreMock: vi.fn(),
  listAlertsMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  getServerAccessToken: vi.fn().mockResolvedValue("server-token"),
}));

vi.mock("@/lib/api", () => ({
  listCompetitors: listCompetitorsMock,
  getCompetitorScore: getCompetitorScoreMock,
  listAlerts: listAlertsMock,
}));

import BriefingPage from "../../app/(app)/briefing/page";

describe("BriefingPage", () => {
  beforeEach(() => {
    listCompetitorsMock.mockReset();
    getCompetitorScoreMock.mockReset();
    listAlertsMock.mockReset();
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
});
