import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import LandingPage from "../../app/page";

describe("LandingPage", () => {
  beforeEach(() => pushMock.mockReset());

  it("offers both entry points in the header", () => {
    render(<LandingPage />);

    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(within(banner).getByRole("link", { name: "Start free" })).toHaveAttribute("href", "/signup");
  });

  it("leads with the forecast promise", () => {
    render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "The weather forecast for your competitors."
    );
  });

  it("states probabilities rather than promising outcomes", () => {
    // The product's central claim is that it never asserts certainty. The
    // homepage is where that promise is easiest to break.
    render(<LandingPage />);

    const body = document.body.textContent ?? "";
    expect(body).toMatch(/probabilit/i);
    expect(body).not.toMatch(/\bguaranteed\b|\bwill definitely\b|\bnever wrong\b/i);
  });

  it("claims no metric, customer or pricing it has not measured", () => {
    // No user counts, no accuracy figures, no "trusted by", no plan pricing.
    // Example figures must sit under an explicit "illustrative" disclaimer.
    render(<LandingPage />);
    const body = document.body.textContent ?? "";

    expect(body).not.toMatch(/\d[\d,.]*\s*\+?\s*(customers|companies|teams|users)\b/i);
    expect(body).not.toMatch(/trusted by|backed by|y combinator/i);
    expect(body).not.toMatch(/\d+%\s*(accurate|accuracy)/i);
    expect(body).not.toMatch(/\$\d|free for your first/i);
    expect(body).toMatch(/illustrative/i);
    expect(body).toMatch(/fictional/i);
  });

  it("names the sources it collects", () => {
    render(<LandingPage />);

    for (const source of ["GitHub", "Changelogs", "Pricing pages", "Job boards", "Docs sites", "Package registries"]) {
      expect(screen.getAllByText(source).length).toBeGreaterThan(0);
    }
  });

  it("sends a typed competitor domain to sign-up, normalized", () => {
    render(<LandingPage />);
    const [input] = screen.getAllByLabelText("A competitor’s website");
    fireEvent.change(input!, { target: { value: "https://www.Kestrel.dev/pricing" } });
    fireEvent.submit(input!.closest("form")!);
    expect(pushMock).toHaveBeenCalledWith("/signup?domain=kestrel.dev");
  });

  it("refuses a value that is not a domain and says why", () => {
    render(<LandingPage />);
    const [input] = screen.getAllByLabelText("A competitor’s website");
    fireEvent.change(input!, { target: { value: "not a website" } });
    fireEvent.submit(input!.closest("form")!);
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/like kestrel\.dev/);
  });

  it("has a footer with product and account destinations", () => {
    render(<LandingPage />);

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/briefing");
    expect(within(footer).getByRole("link", { name: "Create a workspace" })).toHaveAttribute("href", "/signup");
    expect(within(footer).getByRole("navigation", { name: "Product" })).toBeInTheDocument();
  });
});
