import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signUpMock, signInWithOAuthMock, pushMock, refreshMock } = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  signInWithOAuthMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("../../lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      signUp: signUpMock,
      signInWithOAuth: signInWithOAuthMock,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { SignupForm } from "../../app/signup/signup-form";

describe("SignupForm", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    signInWithOAuthMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    signUpMock.mockReset();
    signInWithOAuthMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("submits email/password and redirects home on success", async () => {
    signUpMock.mockResolvedValue({ error: null });
    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    await waitFor(() =>
      expect(signUpMock).toHaveBeenCalledWith({ email: "a@b.com", password: "hunter2" })
    );
    expect(pushMock).toHaveBeenCalledWith("/");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("renders a Supabase error inline, not as a toast", async () => {
    signUpMock.mockResolvedValue({ error: { message: "Password should be at least 6 characters" } });
    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Password should be at least 6 characters")
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("starts Google OAuth when 'Continue with Google' is clicked", async () => {
    signInWithOAuthMock.mockResolvedValue({ error: null });
    render(<SignupForm />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() =>
      expect(signInWithOAuthMock).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/` },
      })
    );
  });
});
