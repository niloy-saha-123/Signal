import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getOptionalAccessToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getActivity: vi.fn().mockResolvedValue({ runs: [], spend_today_usd: 0, daily_budget_usd: 2, open_circuits: [] }),
    listCompetitors: vi.fn().mockResolvedValue([]),
  };
});

import ActivityPage from "../../app/(app)/activity/page";

describe("Activity page", () => {
  it("gives an empty run log a next action", async () => {
    render(await ActivityPage());
    expect(screen.getByRole("link", { name: "Add a competitor" })).toHaveAttribute("href", "/board");
  });
});
