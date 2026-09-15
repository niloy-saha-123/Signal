import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signal, SignalCreatedPayload } from "@signal/shared";

const { onSignalCreatedMock, unsubscribeMock, refreshMock } = vi.hoisted(() => ({
  onSignalCreatedMock: vi.fn(),
  unsubscribeMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("../../lib/socket", () => ({
  onSignalCreated: onSignalCreatedMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { SignalFeed } from "../../components/SignalFeed";

const signal: Signal = {
  id: "sig-1",
  competitor_id: "comp-1",
  source: "reddit",
  source_url: "https://reddit.com/r/x/1",
  title: "Acme cut pricing",
  raw_text: "body text",
  quality_score: 0.8,
  entities: {},
  cluster_id: null,
  collected_at: "2026-09-14T00:00:00.000Z",
  created_at: "2026-09-14T00:00:00.000Z",
};

describe("SignalFeed", () => {
  let capturedHandler: (payload: SignalCreatedPayload) => void;

  beforeEach(() => {
    onSignalCreatedMock.mockImplementation(
      (handler: (payload: SignalCreatedPayload) => void) => {
        capturedHandler = handler;
        return unsubscribeMock;
      }
    );
  });

  afterEach(() => {
    onSignalCreatedMock.mockReset();
    unsubscribeMock.mockReset();
    refreshMock.mockReset();
  });

  it("shows an empty state when given no signals", () => {
    render(<SignalFeed signals={[]} competitorIds={["comp-1"]} />);
    expect(screen.getByText("No signals yet.")).toBeInTheDocument();
  });

  it("renders each signal's title and text", () => {
    render(<SignalFeed signals={[signal]} competitorIds={["comp-1"]} />);
    expect(screen.getByText("Acme cut pricing")).toBeInTheDocument();
    expect(screen.getByText("body text")).toBeInTheDocument();
  });

  it("calls router.refresh() when a signal:new event matches a watched competitor", () => {
    render(<SignalFeed signals={[signal]} competitorIds={["comp-1"]} />);
    act(() => {
      capturedHandler({ id: "sig-2", competitor_id: "comp-1", source: "hn" });
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a signal:new event for a competitor not being watched", () => {
    render(<SignalFeed signals={[signal]} competitorIds={["comp-1"]} />);
    act(() => {
      capturedHandler({ id: "sig-2", competitor_id: "some-other-competitor", source: "hn" });
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = render(<SignalFeed signals={[signal]} competitorIds={["comp-1"]} />);
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});
