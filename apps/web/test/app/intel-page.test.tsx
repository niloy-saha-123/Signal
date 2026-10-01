import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getOptionalAccessToken: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/socket", () => ({
  onSignalCreated: () => () => {},
  joinCompetitor: vi.fn(),
  leaveCompetitor: vi.fn(),
}));

import IntelPage from "../../app/(app)/intel/page";

describe("Evidence feed page", () => {
  it("renders the preview feed under the Evidence header", async () => {
    render(await IntelPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1, name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByText("Enterprise plan split from self-serve")).toBeInTheDocument();
    expect(screen.getByText("Enterprise account hiring up")).toBeInTheDocument();
  });

  it("narrows to evidence matching the search text", async () => {
    render(await IntelPage({ searchParams: Promise.resolve({ q: "audit logs" }) }));
    expect(screen.getByText("SSO and audit logs in the same release")).toBeInTheDocument();
    expect(screen.queryByText("Enterprise account hiring up")).toBeNull();
  });

  it("explains an empty search instead of showing a blank list", async () => {
    render(await IntelPage({ searchParams: Promise.resolve({ q: "zzzz" }) }));
    expect(screen.getByText("Nothing matches “zzzz”")).toBeInTheDocument();
  });
});
