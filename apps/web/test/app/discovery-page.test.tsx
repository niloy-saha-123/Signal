import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getOptionalAccessToken: vi.fn().mockResolvedValue(null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import DiscoveryPage from "../../app/(app)/discovery/page";

describe("DiscoveryPage preview", () => {
  it("shows each preview candidate's name and domain", async () => {
    render(await DiscoveryPage());
    expect(screen.getByText("Rivalex")).toBeInTheDocument();
    expect(screen.getByText("rivalex.com")).toBeInTheDocument();
  });
});
