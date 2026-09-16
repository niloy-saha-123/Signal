import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("next/navigation", () => {
  const router = { push: pushMock, refresh: refreshMock };
  return { useRouter: () => router };
});

import { JoinClient } from "../../app/join/[token]/join-client";

const BASE = "http://localhost:3000";
const TOKEN = "abc123";

function mockFetchOnce(ok: boolean) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok }));
}

describe("JoinClient", () => {
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

  it("prompts to log in or sign up, preserving the token, when there is no active session", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    vi.stubGlobal("fetch", vi.fn());
    render(<JoinClient token={TOKEN} />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      `/login?next=/join/${TOKEN}`
    );
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      `/signup?next=/join/${TOKEN}`
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("joins the workspace and redirects home when a session is active", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    mockFetchOnce(true);
    render(<JoinClient token={TOKEN} />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(fetch).toHaveBeenCalledWith(`${BASE}/api/workspaces/join/${TOKEN}`, {
      method: "POST",
      headers: { Authorization: "Bearer token-123" },
    });
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("renders an invalid-invite message and does not redirect on a 404 response", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    mockFetchOnce(false);
    render(<JoinClient token={TOKEN} />);
    await waitFor(() =>
      expect(screen.getByText("This invite is no longer valid.")).toBeInTheDocument()
    );
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });
});
