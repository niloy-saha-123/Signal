import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Onest: () => ({ variable: "font-onest-test" }),
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

  it("exports a mobile viewport using the Signal Studio browser color", () => {
    expect(viewport).toEqual({
      width: "device-width",
      initialScale: 1,
      themeColor: "#f3faff",
    });
  });
});
