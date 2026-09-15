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
    expect(screen.getByText("Checking discovery status…")).toBeInTheDocument();
  });

  it("renders a found field with a checkmark and a not-found field with a manual-entry hint", async () => {
    getCompetitorDiscoveryMock.mockResolvedValue(pending);
    render(<DiscoveryStatus competitorId="comp-1" pollIntervalMs={3000} />);
    await waitFor(() => expect(screen.getByText("Subreddits")).toBeInTheDocument());
    expect(screen.getByText("✓")).toBeInTheDocument();
    expect(screen.getByText(/not found — enter manually/)).toBeInTheDocument();
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
    screen.getByRole("button", { name: "Enter rss_url manually" }).click();
    expect(onManualEntry).toHaveBeenCalledWith("rss_url");
  });
});
