import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signInWithPasswordMock, signInWithOAuthMock, pushMock, refreshMock, searchParamsMock } =
  vi.hoisted(() => ({
    signInWithPasswordMock: vi.fn(),
    signInWithOAuthMock: vi.fn(),
    pushMock: vi.fn(),
    refreshMock: vi.fn(),
    searchParamsMock: vi.fn(),
  }));

vi.mock("../../lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signInWithOAuth: signInWithOAuthMock,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => ({ get: searchParamsMock }),
}));

import { LoginForm } from "../../app/(auth)/login-form";

describe("LoginForm", () => {
  beforeEach(() => {
    signInWithPasswordMock.mockReset();
    signInWithOAuthMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
    searchParamsMock.mockReset().mockReturnValue(null);
  });

  afterEach(() => {
    signInWithPasswordMock.mockReset();
    signInWithOAuthMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
    searchParamsMock.mockReset();
  });

  it("submits email/password and redirects to / on success when there is no next param", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() =>
      expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: "a@b.com", password: "hunter2" })
    );
    expect(pushMock).toHaveBeenCalledWith("/");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("redirects to the next param on success when one is present", async () => {
    searchParamsMock.mockReturnValue("/join/abc123");
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/join/abc123"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("renders a Supabase error inline, not as a toast", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid login credentials"));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("starts Google OAuth when 'Continue with Google' is clicked", async () => {
    signInWithOAuthMock.mockResolvedValue({ error: null });
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() =>
      expect(signInWithOAuthMock).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/` },
      })
    );
  });
});
