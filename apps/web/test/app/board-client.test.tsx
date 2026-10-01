import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CompetitorBoard, type BoardRow } from "../../app/(app)/board-client";

const rows: BoardRow[] = [
  {
    id: "comp-1",
    name: "Mosaic",
    domain: "mosaic.app",
    score: 72,
    delta: 6,
    openForecasts: 2,
    next: { id: "pred-1", statement: "Mosaic launches an enterprise tier", probability: 0.64, resolvesAt: "2026-11-01T00:00:00.000Z" },
    discovering: false,
  },
  {
    id: "comp-2",
    name: "Zephyr",
    domain: "zephyr.io",
    score: null,
    delta: null,
    openForecasts: 0,
    next: null,
    discovering: true,
  },
  {
    id: "comp-3",
    name: "Bolt",
    domain: "bolt.dev",
    score: 40,
    delta: -9,
    openForecasts: 0,
    next: null,
    discovering: false,
  },
];

function rowLink(name: string) {
  return screen.getByRole("link", { name: new RegExp(`^${name}`) });
}

function names() {
  return screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href")?.startsWith("/radar/"))
    .map((link) => `Open ${link.querySelector("p")?.textContent}`);
}

describe("CompetitorBoard", () => {
  it("links every competitor to its profile with score, weekly change and next forecast", () => {
    render(<CompetitorBoard rows={rows} />);
    const acme = rowLink("Mosaic");
    expect(acme).toHaveAttribute("href", "/radar/comp-1");
    expect(within(acme).getByText("72")).toBeInTheDocument();
    expect(within(acme).getByText("Up 6 this week")).toBeInTheDocument();
    expect(within(acme).getByText("Mosaic launches an enterprise tier")).toBeInTheDocument();
    expect(within(acme).getByText("64%")).toBeInTheDocument();
  });

  it("shows unscored competitors instead of hiding them", () => {
    render(<CompetitorBoard rows={rows} />);
    const zephyr = rowLink("Zephyr");
    expect(within(zephyr).getByText("Finding sources")).toBeInTheDocument();
    expect(within(zephyr).getByText("—")).toBeInTheDocument();
  });

  it("sorts by activity by default, unscored last, and re-sorts by name, change and next forecast", () => {
    render(<CompetitorBoard rows={rows} />);
    expect(names()).toEqual(["Open Mosaic", "Open Bolt", "Open Zephyr"]);
    fireEvent.change(screen.getByLabelText("Sort competitors"), { target: { value: "name" } });
    expect(names()).toEqual(["Open Bolt", "Open Mosaic", "Open Zephyr"]);
    fireEvent.change(screen.getByLabelText("Sort competitors"), { target: { value: "change" } });
    expect(names()).toEqual(["Open Bolt", "Open Mosaic", "Open Zephyr"]);
    fireEvent.change(screen.getByLabelText("Sort competitors"), { target: { value: "next" } });
    expect(names()[0]).toBe("Open Mosaic");
  });

  it("filters by name or domain", () => {
    render(<CompetitorBoard rows={rows} />);
    fireEvent.change(screen.getByLabelText("Find a competitor"), { target: { value: "zeph" } });
    expect(names()).toEqual(["Open Zephyr"]);
    fireEvent.change(screen.getByLabelText("Find a competitor"), { target: { value: "nobody" } });
    expect(screen.getByText("No competitor matches “nobody”")).toBeInTheDocument();
  });

  it("offers the add-competitor input inline", () => {
    render(<CompetitorBoard rows={rows} />);
    expect(screen.getByLabelText("Competitor website")).toBeInTheDocument();
  });

  it("renders a designed empty state with the add input when nothing is watched", () => {
    render(<CompetitorBoard rows={[]} />);
    expect(screen.getByText("You're not watching anyone yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Competitor website")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sort competitors")).toBeNull();
  });
});
