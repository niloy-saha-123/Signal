import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyProfile, Competitor } from "../../lib/api";

const { getCompanyProfileMock, saveCompanyProfileMock, listCompetitorsMock } = vi.hoisted(() => ({
  getCompanyProfileMock: vi.fn(),
  saveCompanyProfileMock: vi.fn(),
  listCompetitorsMock: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  getCompanyProfile: getCompanyProfileMock,
  saveCompanyProfile: saveCompanyProfileMock,
  listCompetitors: listCompetitorsMock,
}));

import Page from "../../app/(app)/settings/page";

const competitors: Competitor[] = [
  {
    id: "comp-1",
    name: "Acme",
    domain: "acme.com",
    subreddits: [],
    greenhouse_token: null,
    lever_token: null,
    pricing_url: null,
    changelog_rss: null,
    is_active: true,
    discovery_status: "complete",
    discovered_at: "2026-09-14T00:00:00.000Z",
    created_at: "2026-09-14T00:00:00.000Z",
    updated_at: "2026-09-14T00:00:00.000Z",
  },
];

describe("Settings page", () => {
  beforeEach(() => {
    listCompetitorsMock.mockResolvedValue(competitors);
  });
  afterEach(() => {
    getCompanyProfileMock.mockReset();
    saveCompanyProfileMock.mockReset();
    listCompetitorsMock.mockReset();
  });

  it("shows the no-profile banner when GET returns null", async () => {
    getCompanyProfileMock.mockResolvedValue(null);
    render(<Page />);
    await waitFor(() =>
      expect(
        screen.getByText(
          "Complete your company profile to get personalized intelligence instead of generic analysis."
        )
      ).toBeInTheDocument()
    );
  });

  it("prefills the form when a profile already exists", async () => {
    const profile: CompanyProfile = {
      product_description: "A widget factory.",
      icp_industries: ["SaaS"],
      pricing_tiers: [],
      key_differentiators: [],
      primary_competitor_ids: [],
    };
    getCompanyProfileMock.mockResolvedValue(profile);
    render(<Page />);
    await waitFor(() =>
      expect(screen.getByLabelText("Product description")).toHaveValue("A widget factory.")
    );
  });

  it("saves the form and parses comma-separated tag inputs into arrays", async () => {
    getCompanyProfileMock.mockResolvedValue(null);
    saveCompanyProfileMock.mockResolvedValue({});
    render(<Page />);
    await waitFor(() => expect(screen.getByLabelText("Product description")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Product description"), {
      target: { value: "A widget factory." },
    });
    fireEvent.change(screen.getByLabelText("ICP industries (comma-separated)"), {
      target: { value: "SaaS, Fintech" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(saveCompanyProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          product_description: "A widget factory.",
          icp_industries: ["SaaS", "Fintech"],
        })
      )
    );
  });
});
