import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LandingPage from "../../app/page";

describe("LandingPage", () => {
  it("offers both entry points in the header", () => {
    render(<LandingPage />);

    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login"
    );
    expect(within(banner).getByRole("link", { name: "Start tracking" })).toHaveAttribute(
      "href",
      "/signup"
    );
  });

  it("states probabilities rather than promising outcomes", () => {
    // The product's central claim is that it never asserts certainty. The
    // homepage is where that promise is easiest to break and most damaging to
    // break, so it is pinned here.
    render(<LandingPage />);

    const body = document.body.textContent ?? "";
    expect(body).toMatch(/probabilit/i);
    expect(body).not.toMatch(/\bguaranteed\b|\bwill definitely\b|\bnever wrong\b/i);
  });

  it("claims no metric it has not measured", () => {
    // No user counts, no accuracy figures, no "trusted by N teams". Signal has
    // no customers and no published accuracy yet, and a forecasting product
    // caught inventing its own numbers has destroyed the only thing it sells.
    //
    // The illustrative ledger is exempt by being explicitly labelled — the
    // check below requires that label to be present.
    render(<LandingPage />);
    const body = document.body.textContent ?? "";

    expect(body).not.toMatch(/\d[\d,.]*\s*(customers|companies|teams|users)\b/i);
    expect(body).not.toMatch(/trusted by/i);
    expect(body).not.toMatch(/\d+%\s*(accurate|accuracy)/i);
    // Any example figures must sit under an explicit disclaimer.
    expect(body).toMatch(/illustrative/i);
  });

  it("names the sources it actually collects", () => {
    render(<LandingPage />);

    for (const source of ["GitHub", "Changelogs", "Pricing pages", "Job boards"]) {
      expect(screen.getByText(source)).toBeInTheDocument();
    }
  });

  it("has a product footer with workspace and account destinations", () => {
    render(<LandingPage />);

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Briefing" })).toHaveAttribute(
      "href",
      "/briefing"
    );
    expect(within(footer).getByRole("link", { name: "Create a workspace" })).toHaveAttribute(
      "href",
      "/signup"
    );
    expect(within(footer).getByRole("navigation", { name: "Product" })).toBeInTheDocument();
  });
});
