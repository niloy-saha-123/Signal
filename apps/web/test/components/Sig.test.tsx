import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sig } from "../../components/brand/Sig";

describe("Sig", () => {
  it("is an image with an accessible name by default", () => {
    render(<Sig />);
    expect(screen.getByRole("img", { name: "Sig, Signal's assistant" })).toHaveAttribute(
      "data-mood",
      "idle"
    );
  });

  it("is hidden from assistive tech when decorative", () => {
    const { container } = render(<Sig decorative mood="thinking" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it.each(["idle", "thinking", "happy", "unsure"] as const)("renders the %s mood", (mood) => {
    render(<Sig mood={mood} title={`sig ${mood}`} />);
    expect(screen.getByRole("img", { name: `sig ${mood}` })).toHaveAttribute("data-mood", mood);
  });
});
