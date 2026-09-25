import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Funnel_Display: () => ({ variable: "font-funnel-display-test" }),
  Geist: () => ({ variable: "font-geist-test" }),
  Geist_Mono: () => ({ variable: "font-geist-mono-test" }),
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
      themeColor: "#f9fafd",
    });
  });
});
