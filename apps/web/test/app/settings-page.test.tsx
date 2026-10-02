import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUserMock,
  updateUserMock,
  signOutMock,
  getWorkspaceMock,
  renameWorkspaceMock,
  pushMock,
  refreshMock,
  replaceMock,
  getSlackStatusMock,
  startSlackInstallMock,
  disconnectSlackMock,
  confirmSlackInstallMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  updateUserMock: vi.fn(),
  signOutMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  renameWorkspaceMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
  getSlackStatusMock: vi.fn(),
  startSlackInstallMock: vi.fn(),
  disconnectSlackMock: vi.fn(),
  confirmSlackInstallMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: replaceMock }),
}));

vi.mock("../../lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getUser: getUserMock,
      updateUser: updateUserMock,
      signOut: signOutMock,
    },
  }),
}));

vi.mock("../../lib/api", () => ({
  getWorkspace: getWorkspaceMock,
  renameWorkspace: renameWorkspaceMock,
  getSlackStatus: getSlackStatusMock,
  startSlackInstall: startSlackInstallMock,
  disconnectSlack: disconnectSlackMock,
  confirmSlackInstall: confirmSlackInstallMock,
}));

import Page from "../../app/(app)/settings/page";

describe("Settings page", () => {
  beforeEach(() => {
    getUserMock.mockResolvedValue({
      data: { user: { email: "jane@acme.com", user_metadata: { full_name: "Jane" } } },
    });
    getWorkspaceMock.mockResolvedValue({ id: "ws-1", name: "Acme", owner_id: "u1", created_at: "" });
    getSlackStatusMock.mockResolvedValue({ connected: false });
  });

  afterEach(() => {
    getUserMock.mockReset();
    updateUserMock.mockReset();
    signOutMock.mockReset();
    getWorkspaceMock.mockReset();
    renameWorkspaceMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
    replaceMock.mockReset();
    getSlackStatusMock.mockReset();
    startSlackInstallMock.mockReset();
    disconnectSlackMock.mockReset();
    confirmSlackInstallMock.mockReset();
    window.history.replaceState({}, "", "/settings");
  });

  it("prefills email and company name", async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByDisplayValue("jane@acme.com")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Acme")).toBeInTheDocument();
  });

  it("saves the display name via updateUser", async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByLabelText("Display name")).toBeInTheDocument());
    updateUserMock.mockResolvedValue({ error: null });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Jane Doe" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith({ data: { full_name: "Jane Doe" } })
    );
  });

  it("renames the workspace via renameWorkspace", async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByLabelText("Company name")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme Inc." } });
    fireEvent.click(screen.getByRole("button", { name: "Save company name" }));
    await waitFor(() => expect(renameWorkspaceMock).toHaveBeenCalledWith("Acme Inc."));
  });

  it("signs out and routes to /login", async () => {
    signOutMock.mockResolvedValue(undefined);
    render(<Page />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it("links Settings and Activity as one area", async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("href", "/activity"));
  });

  it("rejects mismatched passwords without calling the API", async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByLabelText("New password")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "longenough1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different22" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  describe("Slack", () => {
    it("starts the install by sending the browser to Slack", async () => {
      const assign = vi.fn();
      vi.stubGlobal("location", { ...window.location, search: "", assign });
      startSlackInstallMock.mockResolvedValue({ url: "https://slack.com/oauth/v2/authorize?x=1" });
      render(<Page />);
      fireEvent.click(await screen.findByRole("button", { name: /add to slack/i }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith("https://slack.com/oauth/v2/authorize?x=1"));
      vi.unstubAllGlobals();
    });

    it("explains when the server has no Slack config", async () => {
      startSlackInstallMock.mockRejectedValue(Object.assign(new Error("x"), { status: 503 }));
      render(<Page />);
      fireEvent.click(await screen.findByRole("button", { name: /add to slack/i }));
      expect(await screen.findByText("Slack isn't configured on this server.")).toBeInTheDocument();
    });

    it("shows the connected team and channel, and disconnects", async () => {
      getSlackStatusMock
        .mockResolvedValueOnce({ connected: true, team_name: "Acme", channel_name: "#intel" })
        .mockResolvedValueOnce({ connected: false });
      disconnectSlackMock.mockResolvedValue(undefined);
      render(<Page />);
      expect(await screen.findByText("Acme")).toBeInTheDocument();
      expect(screen.getByText("#intel")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
      await waitFor(() => expect(disconnectSlackMock).toHaveBeenCalled());
      expect(await screen.findByRole("button", { name: /add to slack/i })).toBeInTheDocument();
    });

    it.each([
      ["cancelled", "Slack install cancelled."],
      ["error", "Couldn't connect Slack. Try again."],
    ])("shows the ?slack=%s result and clears the param", async (value, text) => {
      window.history.replaceState({}, "", `/settings?slack=${value}`);
      render(<Page />);
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(replaceMock).toHaveBeenCalledWith("/settings");
    });

    it("confirms ?slack_install=<id>, shows the team and clears the param", async () => {
      window.history.replaceState({}, "", "/settings?slack_install=inst-1");
      confirmSlackInstallMock.mockResolvedValue({ connected: true, team_name: "Acme", channel_name: "#intel" });
      render(<Page />);
      expect(await screen.findByText("Slack connected.")).toBeInTheDocument();
      expect(confirmSlackInstallMock).toHaveBeenCalledWith("inst-1");
      expect(await screen.findByText("#intel")).toBeInTheDocument();
      expect(replaceMock).toHaveBeenCalledWith("/settings");
    });

    it.each([
      [409, "That Slack workspace is already connected to another Signal workspace."],
      [403, "That Slack install was started from a different Signal account."],
      [410, "Couldn't connect Slack. Try again."],
      [500, "Couldn't connect Slack. Try again."],
    ])("maps a %s confirm failure", async (status, text) => {
      window.history.replaceState({}, "", "/settings?slack_install=inst-1");
      confirmSlackInstallMock.mockRejectedValue(Object.assign(new Error("x"), { status }));
      render(<Page />);
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(replaceMock).toHaveBeenCalledWith("/settings");
    });
  });
});
