import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, refreshSessionMock, pushMock, refreshMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  refreshSessionMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("../../lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: getSessionMock,
      refreshSession: refreshSessionMock,
    },
  }),
}));

const { resolveCompanyMock, createCompetitorMock, startSlackInstallMock } = vi.hoisted(() => ({
  resolveCompanyMock: vi.fn(),
  createCompetitorMock: vi.fn(),
  startSlackInstallMock: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  resolveCompany: resolveCompanyMock,
  createCompetitor: createCompetitorMock,
  startSlackInstall: startSlackInstallMock,
  getSlackStatus: vi.fn(),
  disconnectSlack: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { OnboardingForm } from "../../app/(auth)/onboarding/onboarding-form";

const BASE = "http://localhost:3000";

function mockFetchOnce(ok: boolean) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok }));
}

describe("OnboardingForm", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    refreshSessionMock.mockReset().mockResolvedValue({ data: { session: null } });
    pushMock.mockReset();
    refreshMock.mockReset();
    resolveCompanyMock.mockReset();
    createCompetitorMock.mockReset();
  });

  afterEach(() => {
    getSessionMock.mockReset();
    refreshSessionMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("creates a workspace, refreshes the session and moves to the competitor step", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    mockFetchOnce(true);
    render(<OnboardingForm />);
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Acme Inc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await screen.findByRole("heading", { name: "Who should Signal watch first?" });
    expect(fetch).toHaveBeenCalledWith(`${BASE}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token-123" },
      body: JSON.stringify({ name: "Acme Inc" }),
    });
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  async function reachCompetitorStep() {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    mockFetchOnce(true);
    render(<OnboardingForm />);
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Acme Inc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await screen.findByRole("heading", { name: "Who should Signal watch first?" });
  }

  it("pre-fills the competitor typed on the landing page", async () => {
    window.localStorage.setItem("signal:first-competitor", "Kestrel.dev");
    await reachCompetitorStep();
    await waitFor(() => expect(screen.getByLabelText("Competitor website")).toHaveValue("kestrel.dev"));
    window.localStorage.clear();
  });

  it("adds a competitor, then finishes on the ready step and goes home", async () => {
    resolveCompanyMock.mockResolvedValue({ name: "Kestrel", domain: "kestrel.dev" });
    createCompetitorMock.mockResolvedValue({ id: "c1", name: "Kestrel", domain: "kestrel.dev" });
    await reachCompetitorStep();
    fireEvent.change(screen.getByLabelText("Competitor website"), { target: { value: "https://www.kestrel.dev/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add competitor" }));
    await screen.findByText("Added");
    expect(createCompetitorMock).toHaveBeenCalledWith({ name: "Kestrel", domain: "kestrel.dev" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Go to Home" }));
    expect(pushMock).toHaveBeenCalledWith("/briefing");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("offers Add to Slack beside Go to Home on the ready step", async () => {
    resolveCompanyMock.mockResolvedValue({ name: "Kestrel", domain: "kestrel.dev" });
    createCompetitorMock.mockResolvedValue({ id: "c1", name: "Kestrel", domain: "kestrel.dev" });
    await reachCompetitorStep();
    fireEvent.change(screen.getByLabelText("Competitor website"), { target: { value: "kestrel.dev" } });
    fireEvent.click(screen.getByRole("button", { name: "Add competitor" }));
    await screen.findByText("Added");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("button", { name: /add to slack/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /go to home/i })).toBeInTheDocument();
  });

  it("rejects an invalid website without calling the API", async () => {
    await reachCompetitorStep();
    fireEvent.change(screen.getByLabelText("Competitor website"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Add competitor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/like kestrel\.dev/);
    expect(createCompetitorMock).not.toHaveBeenCalled();
  });

  it("falls back to a name from the domain when resolution fails", async () => {
    resolveCompanyMock.mockRejectedValue(new Error("down"));
    createCompetitorMock.mockResolvedValue({ id: "c2", name: "lumen", domain: "lumen.ai" });
    await reachCompetitorStep();
    fireEvent.change(screen.getByLabelText("Competitor website"), { target: { value: "lumen.ai" } });
    fireEvent.click(screen.getByRole("button", { name: "Add competitor" }));
    await waitFor(() => expect(createCompetitorMock).toHaveBeenCalledWith({ name: "lumen", domain: "lumen.ai" }));
  });

  it("lets someone skip adding a competitor", async () => {
    await reachCompetitorStep();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(pushMock).toHaveBeenCalledWith("/briefing");
  });

  it("renders an inline error and never calls fetch when there is no active session", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    vi.stubGlobal("fetch", vi.fn());
    render(<OnboardingForm />);
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Acme Inc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Session expired — please log in again.")
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders an inline error and does not redirect when the request fails", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    mockFetchOnce(false);
    render(<OnboardingForm />);
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Acme Inc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not create your workspace — try again.")
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("resumes at the competitor step when the workspace already exists (reload mid-setup)", async () => {
    const payload = btoa(JSON.stringify({ workspace_id: "ws-1" })).replace(/=+$/, "");
    getSessionMock.mockResolvedValue({ data: { session: { access_token: `h.${payload}.s` } } });
    vi.stubGlobal("fetch", vi.fn());
    render(<OnboardingForm />);
    await screen.findByRole("heading", { name: "Who should Signal watch first?" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("doesn't promise a Slack setup that isn't built yet", async () => {
    createCompetitorMock.mockResolvedValue({ id: "c1", name: "Kestrel", domain: "kestrel.dev" });
    resolveCompanyMock.mockResolvedValue({ name: "Kestrel", domain: "kestrel.dev" });
    await reachCompetitorStep();
    fireEvent.change(screen.getByLabelText("Competitor website"), { target: { value: "kestrel.dev" } });
    fireEvent.click(screen.getByRole("button", { name: "Add competitor" }));
    await screen.findByText("Added");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Go to Home" });
    expect(screen.queryByRole("link", { name: /Slack/ })).toBeNull();
  });
});
