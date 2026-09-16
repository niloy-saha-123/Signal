import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyProfile, Competitor } from "../../lib/api";

const { getCompanyProfileMock, saveCompanyProfileMock, listCompetitorsMock, getSessionMock } =
  vi.hoisted(() => ({
    getCompanyProfileMock: vi.fn(),
    saveCompanyProfileMock: vi.fn(),
    listCompetitorsMock: vi.fn(),
    getSessionMock: vi.fn(),
  }));

vi.mock("../../lib/api", () => ({
  getCompanyProfile: getCompanyProfileMock,
  saveCompanyProfile: saveCompanyProfileMock,
  listCompetitors: listCompetitorsMock,
}));

vi.mock("../../lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: getSessionMock,
    },
  }),
}));

import Page from "../../app/settings/page";

const BASE = "http://localhost:3000";

function mockFetchOnce(response: { ok: boolean; json?: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: response.ok, json: response.json ?? (() => Promise.resolve({})) })
  );
}

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
    getSessionMock.mockReset();
    vi.unstubAllGlobals();
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

  it("invites a teammate and shows a copyable invite link on success", async () => {
    getCompanyProfileMock.mockResolvedValue(null);
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    mockFetchOnce({
      ok: true,
      json: () => Promise.resolve({ token: "invite-abc", expires_at: "2026-09-23T00:00:00.000Z" }),
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
    render(<Page />);
    await waitFor(() => expect(screen.getByLabelText("Product description")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Invite teammate" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(`${BASE}/api/workspaces/invites`, {
        method: "POST",
        headers: { Authorization: "Bearer token-123" },
      })
    );

    const inviteLink = `${window.location.origin}/join/invite-abc`;
    await waitFor(() => expect(screen.getByDisplayValue(inviteLink)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(inviteLink);
  });

  it("renders an inline error when the invite request fails", async () => {
    getCompanyProfileMock.mockResolvedValue(null);
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    mockFetchOnce({ ok: false });
    render(<Page />);
    await waitFor(() => expect(screen.getByLabelText("Product description")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Invite teammate" }));

    await waitFor(() =>
      expect(screen.getByText("Could not create an invite — try again.")).toBeInTheDocument()
    );
  });
});
