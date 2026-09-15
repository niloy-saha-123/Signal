import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/SiteNav", () => ({ SiteNav: () => <nav data-testid="site-nav" /> }));
vi.mock("@/components/AlertBanner", () => ({
  AlertBanner: () => <div data-testid="alert-banner" />,
}));
vi.mock("../../app/app-command-bar", () => ({
  AppCommandBar: () => <div data-testid="app-command-bar" />,
}));

import RootLayout from "../../app/layout";

describe("RootLayout", () => {
  it("mounts AlertBanner alongside SiteNav and AppCommandBar", () => {
    render(
      <RootLayout>
        <p>page content</p>
      </RootLayout>
    );
    expect(screen.getByTestId("site-nav")).toBeInTheDocument();
    expect(screen.getByTestId("app-command-bar")).toBeInTheDocument();
    expect(screen.getByTestId("alert-banner")).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
