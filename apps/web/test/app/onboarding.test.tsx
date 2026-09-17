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
  });

  afterEach(() => {
    getSessionMock.mockReset();
    refreshSessionMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("creates a workspace and redirects home on success", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    mockFetchOnce(true);
    render(<OnboardingForm />);
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Acme Inc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/briefing"));
    expect(fetch).toHaveBeenCalledWith(`${BASE}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token-123" },
      body: JSON.stringify({ name: "Acme Inc" }),
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
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
});
