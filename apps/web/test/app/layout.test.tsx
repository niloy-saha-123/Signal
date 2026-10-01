import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Funnel_Display: () => ({ variable: "font-funnel-test" }),
  Hanken_Grotesk: () => ({ variable: "font-hanken-test" }),
}));

import RootLayout, { viewport } from "../../app/layout";

describe("RootLayout", () => {
  it("renders page content", () => {
    render(
      <RootLayout>
        <p>page content</p>
      </RootLayout>
    );

    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("exports a mobile viewport using the sky ground as the browser chrome", () => {
    expect(viewport).toEqual({
      width: "device-width",
      initialScale: 1,
      themeColor: "#eef5fa",
    });
  });
});
