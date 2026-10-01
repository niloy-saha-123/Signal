import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppError from "../../app/(app)/error";

describe("App error boundary", () => {
  it("offers a retry and a way home, and shows the reference", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    const { container } = render(<AppError error={error} reset={reset} />);
    expect(container.querySelector('[data-mood="unsure"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/briefing");
    expect(screen.getByText("Reference: abc123")).toBeInTheDocument();
    expect(screen.queryByText("boom")).toBeNull();
  });
});
