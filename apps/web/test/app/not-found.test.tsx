import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotFound from "../../app/not-found";

describe("404", () => {
  it("says what happened, shows Sig and offers a way back", () => {
    const { container } = render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "This page isn't on the map" })).toBeInTheDocument();
    expect(container.querySelector('[data-mood="unsure"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/briefing");
  });
});
