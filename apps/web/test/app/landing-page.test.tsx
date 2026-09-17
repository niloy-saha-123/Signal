import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LandingPage from "../../app/page";

describe("LandingPage", () => {
  it("provides accessible section navigation on mobile", () => {
    render(<LandingPage />);

    expect(screen.getByLabelText("Open section navigation")).toBeInTheDocument();
    const mobileNav = screen.getByRole("navigation", {
      name: "Mobile section navigation",
    });
    const workflowLink = within(mobileNav).getByRole("link", { name: "How it works" });
    expect(workflowLink).toHaveAttribute("href", "#workflow");
    expect(within(mobileNav).getByRole("link", { name: "Product" })).toHaveAttribute(
      "href",
      "#product",
    );
    expect(within(mobileNav).getByRole("link", { name: "Research chat" })).toHaveAttribute(
      "href",
      "#research",
    );

    const details = mobileNav.closest("details");
    expect(details).not.toBeNull();
    if (!details) return;
    details.open = true;
    fireEvent.click(workflowLink);
    expect(details.open).toBe(false);
  });

  it("lets product movement and interpretation headings lead without kickers", () => {
    render(<LandingPage />);

    expect(screen.queryByText("Movement detected")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "A packaging change signals enterprise intent",
      }),
    ).toBeInTheDocument();
  });
});
