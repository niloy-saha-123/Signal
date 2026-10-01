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
  is_own_company: false,
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

  it("names sources in words, not ids", () => {
    render(<IntelFilters competitors={competitors} />);
    expect(screen.getByRole("option", { name: "Hacker News" })).toHaveValue("hn");
  });

  it("filters to strong evidence only", () => {
    render(<IntelFilters competitors={competitors} />);
    fireEvent.change(screen.getByLabelText("Quality"), { target: { value: "0.7" } });
    expect(pushMock).toHaveBeenCalledWith("/intel?source=reddit&min_quality=0.7");
  });

  it("searches on submit, not on every keystroke", () => {
    render(<IntelFilters competitors={competitors} />);
    const search = screen.getByLabelText("Search evidence");
    fireEvent.change(search, { target: { value: "sso" } });
    expect(pushMock).not.toHaveBeenCalled();
    fireEvent.submit(search);
    expect(pushMock).toHaveBeenCalledWith("/intel?source=reddit&q=sso");
  });
});
