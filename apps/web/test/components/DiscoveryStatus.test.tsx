import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitorDiscovery } from "../../lib/api";

const { getCompetitorDiscoveryMock } = vi.hoisted(() => ({
  getCompetitorDiscoveryMock: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  getCompetitorDiscovery: getCompetitorDiscoveryMock,
}));

import { DiscoveryStatus } from "../../components/DiscoveryStatus";

const pending: CompetitorDiscovery = {
  discovery_status: "in_progress",
  log: [
    {
      field_name: "subreddits",
      attempted_urls: ["https://reddit.com/search?q=acme"],
      discovered_value: "r/acme",
      status: "found",
      error_message: null,
    },
    {
      field_name: "rss_url",
      attempted_urls: ["https://acme.com/feed"],
      discovered_value: null,
      status: "not_found",
      error_message: null,
    },
  ],
};

const complete: CompetitorDiscovery = {
  ...pending,
  discovery_status: "complete",
};

describe("DiscoveryStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    getCompetitorDiscoveryMock.mockReset();
    vi.useRealTimers();
  });

  it("shows a loading state before the first poll resolves", () => {
    getCompetitorDiscoveryMock.mockReturnValue(new Promise(() => {}));
    render(<DiscoveryStatus competitorId="comp-1" pollIntervalMs={3000} />);
    expect(screen.getByText("Checking which sources were found…")).toBeInTheDocument();
  });

  it("labels found and not-found fields in words, not glyphs", async () => {
    getCompetitorDiscoveryMock.mockResolvedValue(pending);
    render(<DiscoveryStatus competitorId="comp-1" pollIntervalMs={3000} />);
    await waitFor(() => expect(screen.getByText("Subreddits")).toBeInTheDocument());
    expect(screen.getByText("Subreddits").closest("li")).toHaveTextContent("Found");
    expect(screen.getByText("RSS feed").closest("li")).toHaveTextContent("Not found");
  });

  it("polls again after pollIntervalMs and stops once discovery_status is complete", async () => {
    getCompetitorDiscoveryMock.mockResolvedValueOnce(pending).mockResolvedValueOnce(complete);
    render(<DiscoveryStatus competitorId="comp-1" pollIntervalMs={3000} />);
    await waitFor(() => expect(getCompetitorDiscoveryMock).toHaveBeenCalledTimes(1));

    // vi.advanceTimersByTimeAsync (not the sync advanceTimersByTime) is required here — the
    // interval callback is itself async (awaits getCompetitorDiscovery), and only the Async
    // variant advances fake timers and flushes the resulting promise microtasks in lockstep.
    await vi.advanceTimersByTimeAsync(3000);
    expect(getCompetitorDiscoveryMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3000);
    // No third call — polling stopped after discovery_status became "complete".
    expect(getCompetitorDiscoveryMock).toHaveBeenCalledTimes(2);
  });

  it("calls onManualEntry with the field name when its button is clicked", async () => {
    const onManualEntry = vi.fn();
    getCompetitorDiscoveryMock.mockResolvedValue(pending);
    render(
      <DiscoveryStatus competitorId="comp-1" pollIntervalMs={3000} onManualEntry={onManualEntry} />
    );
    await waitFor(() => expect(screen.getByText("Subreddits")).toBeInTheDocument());
    screen.getByRole("button", { name: "Enter RSS feed manually" }).click();
    expect(onManualEntry).toHaveBeenCalledWith("rss_url");
  });

  it("says it couldn't check instead of hanging when the poll fails", async () => {
    getCompetitorDiscoveryMock.mockRejectedValue(new Error("down"));
    render(<DiscoveryStatus competitorId="comp-1" pollIntervalMs={3000} />);
    await waitFor(() => expect(screen.getByText("Couldn't check discovery right now. Retrying.")).toBeInTheDocument());
  });
});
