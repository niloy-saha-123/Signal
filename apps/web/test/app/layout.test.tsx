import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Instrument_Sans: () => ({ variable: "font-instrument-sans-test" }),
  JetBrains_Mono: () => ({ variable: "font-jetbrains-mono-test" }),
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

  it("exports a mobile viewport using the ground colour as the browser chrome", () => {
    expect(viewport).toEqual({
      width: "device-width",
      initialScale: 1,
      themeColor: "#faf9f7",
    });
  });
});
