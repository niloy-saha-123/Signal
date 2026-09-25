import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOptionalAccessTokenMock } = vi.hoisted(() => ({
  getOptionalAccessTokenMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  getOptionalAccessToken: getOptionalAccessTokenMock,
}));
vi.mock("@/components/AppSidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/TopBar", () => ({ TopBar: () => null }));
vi.mock("@/components/ChatSidebar", () => ({ ChatSidebar: () => null }));
vi.mock("@/components/AlertBanner", () => ({ AlertBanner: () => null }));
vi.mock("../../app/app-command-bar", () => ({ AppCommandBar: () => null }));

import AppLayout from "../../app/(app)/layout";

describe("AppLayout", () => {
  beforeEach(() => getOptionalAccessTokenMock.mockReset());

  it("labels the unauthenticated preview so its figures never read as real data", async () => {
    getOptionalAccessTokenMock.mockResolvedValue(null);
    render(await AppLayout({ children: <p>page</p> }));
    expect(screen.getByRole("status")).toHaveTextContent(/example data/i);
  });

  it("shows no preview label inside a signed-in workspace", async () => {
    getOptionalAccessTokenMock.mockResolvedValue("token");
    render(await AppLayout({ children: <p>page</p> }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("page")).toBeInTheDocument();
  });
});
