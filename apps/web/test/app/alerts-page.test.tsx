import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { tokenMock, listCompetitorsMock, listAlertsMock } = vi.hoisted(() => ({
  tokenMock: vi.fn(),
  listCompetitorsMock: vi.fn(),
  listAlertsMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({ getOptionalAccessToken: tokenMock }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, listCompetitors: listCompetitorsMock, listAlerts: listAlertsMock };
});

import AlertsPage from "../../app/(app)/alerts/page";

describe("Alerts page", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows each alert's move, confidence, recommended action and an Ask button (preview)", async () => {
    tokenMock.mockResolvedValue(undefined);
    render(await AlertsPage());
    expect(screen.getByRole("heading", { level: 1, name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByText("Pricing packaging split")).toBeInTheDocument();
    expect(screen.getByText("86% confident")).toBeInTheDocument();
    expect(screen.getByText(/Check whether your own self-serve tier/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Ask Signal about this" }).length).toBeGreaterThan(0);
  });

  it("renders a designed empty state for a workspace with no competitors", async () => {
    tokenMock.mockResolvedValue("tok");
    listCompetitorsMock.mockResolvedValue([]);
    render(await AlertsPage());
    expect(screen.getByText("No alerts yet")).toBeInTheDocument();
    expect(listAlertsMock).not.toHaveBeenCalled();
  });
});
