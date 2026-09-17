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
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  updateUserMock: vi.fn(),
  signOutMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  renameWorkspaceMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
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
}));

import Page from "../../app/(app)/settings/page";

describe("Settings page", () => {
  beforeEach(() => {
    getUserMock.mockResolvedValue({
      data: { user: { email: "jane@acme.com", user_metadata: { full_name: "Jane" } } },
    });
    getWorkspaceMock.mockResolvedValue({ id: "ws-1", name: "Acme", owner_id: "u1", created_at: "" });
  });

  afterEach(() => {
    getUserMock.mockReset();
    updateUserMock.mockReset();
    signOutMock.mockReset();
    getWorkspaceMock.mockReset();
    renameWorkspaceMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
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
});