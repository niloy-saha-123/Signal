import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Competitor } from "../../lib/api";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams("source=reddit"),
}));

import { IntelFilters } from "../../app/(app)/intel-filters";

const competitors: Competitor[] = [
  {
    id: "comp-1",
    name: "Acme",
    domain: "acme.com",
    subreddits: [],
    greenhouse_token: null,
    lever_token: null,
    pricing_url: null,
    changelog_rss: null,
    is_active: true,
    discovery_status: "complete",
    discovered_at: "2026-09-14T00:00:00.000Z",
    created_at: "2026-09-14T00:00:00.000Z",
    updated_at: "2026-09-14T00:00:00.000Z",
  },
];

describe("IntelFilters", () => {
  beforeEach(() => pushMock.mockReset());

  it("pre-selects the source from the current URL search params", () => {
    render(<IntelFilters competitors={competitors} />);
    expect(screen.getByLabelText("Source")).toHaveValue("reddit");
  });

  it("navigates with an updated source query param on change", () => {
    render(<IntelFilters competitors={competitors} />);
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "hn" } });
    expect(pushMock).toHaveBeenCalledWith("/intel?source=hn");
  });
});
