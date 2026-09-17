import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Competitor } from "../../lib/api";

const { createCompetitorMock, refreshMock } = vi.hoisted(() => ({
  createCompetitorMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  createCompetitor: createCompetitorMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("../../components/DiscoveryStatus", () => ({
  DiscoveryStatus: ({ competitorId }: { competitorId: string }) => (
    <div data-testid="discovery-status">{competitorId}</div>
  ),
}));

import { HomeClient } from "../../app/(app)/home-client";

const created: Competitor = {
  id: "new-id",
  name: "Acme",
  domain: "acme.com",
  subreddits: [],
  greenhouse_token: null,
  lever_token: null,
  pricing_url: null,
  changelog_rss: null,
  is_active: true,
  discovery_status: "pending",
  discovered_at: null,
  created_at: "2026-09-15T00:00:00.000Z",
  updated_at: "2026-09-15T00:00:00.000Z",
};

describe("HomeClient", () => {
  beforeEach(() => {
    createCompetitorMock.mockReset();
    refreshMock.mockReset();
  });
  afterEach(() => {
    createCompetitorMock.mockReset();
    refreshMock.mockReset();
  });

  it("submits the add-competitor form and refreshes on success", async () => {
    createCompetitorMock.mockResolvedValue(created);
    render(<HomeClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add competitor" }));
    await waitFor(() =>
      expect(createCompetitorMock).toHaveBeenCalledWith({ name: "Acme", domain: "acme.com" })
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("shows DiscoveryStatus for the just-added competitor", async () => {
    createCompetitorMock.mockResolvedValue(created);
    render(<HomeClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add competitor" }));
    await waitFor(() => expect(screen.getByTestId("discovery-status")).toHaveTextContent("new-id"));
  });

  it("shows an error message when createCompetitor fails", async () => {
    createCompetitorMock.mockRejectedValue(new Error("validation failed"));
    render(<HomeClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add competitor" }));
    await waitFor(() =>
      expect(screen.getByText("Couldn't add that competitor. Check the domain and try again.")).toBeInTheDocument()
    );
  });
});
