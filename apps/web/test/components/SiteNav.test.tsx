import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteNav } from "../../components/SiteNav";

describe("SiteNav", () => {
  it("renders a link for every command-center view", () => {
    render(<SiteNav />);
    const expected = [
      ["Home", "/"],
      ["Intel", "/intel"],
      ["Chat", "/chat"],
      ["Alerts", "/alerts"],
      ["Settings", "/settings"],
      ["Board", "/board"],
    ] as const;
    for (const [label, href] of expected) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });
});
