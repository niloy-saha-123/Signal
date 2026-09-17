import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LandingPage from "../../app/page";

describe("LandingPage", () => {
  it("provides accessible section navigation on mobile", () => {
    render(<LandingPage />);

    expect(screen.getByLabelText("Open section navigation")).toBeInTheDocument();
    const mobileNav = screen.getByRole("navigation", {
      name: "Mobile section navigation",
    });
    expect(within(mobileNav).getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "#workflow",
    );
    expect(within(mobileNav).getByRole("link", { name: "Product" })).toHaveAttribute(
      "href",
      "#product",
    );
    expect(within(mobileNav).getByRole("link", { name: "Research chat" })).toHaveAttribute(
      "href",
      "#research",
    );
  });
});
