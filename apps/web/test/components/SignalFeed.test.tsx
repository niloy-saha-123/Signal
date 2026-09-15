import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signal, SignalCreatedPayload } from "@signal/shared";

const { onSignalCreatedMock, unsubscribeMock, refreshMock, joinCompetitorMock, leaveCompetitorMock } =
  vi.hoisted(() => ({
    onSignalCreatedMock: vi.fn(),
    unsubscribeMock: vi.fn(),
    refreshMock: vi.fn(),
    joinCompetitorMock: vi.fn(),
    leaveCompetitorMock: vi.fn(),
  }));

vi.mock("../../lib/socket", () => ({
  onSignalCreated: onSignalCreatedMock,
  joinCompetitor: joinCompetitorMock,
  leaveCompetitor: leaveCompetitorMock,
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
    joinCompetitorMock.mockReset();
    leaveCompetitorMock.mockReset();
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

  it("joins every competitor room on mount", () => {
    render(<SignalFeed signals={[signal]} competitorIds={["comp-1", "comp-2"]} />);
    expect(joinCompetitorMock).toHaveBeenCalledWith("comp-1");
    expect(joinCompetitorMock).toHaveBeenCalledWith("comp-2");
    expect(leaveCompetitorMock).not.toHaveBeenCalled();
  });

  it("leaves every joined competitor room on unmount", () => {
    const { unmount } = render(
      <SignalFeed signals={[signal]} competitorIds={["comp-1", "comp-2"]} />
    );
    unmount();
    expect(leaveCompetitorMock).toHaveBeenCalledWith("comp-1");
    expect(leaveCompetitorMock).toHaveBeenCalledWith("comp-2");
  });

  it("leaves old rooms and joins new ones when competitorIds changes", () => {
    const { rerender } = render(<SignalFeed signals={[signal]} competitorIds={["comp-1"]} />);
    joinCompetitorMock.mockClear();
    rerender(<SignalFeed signals={[signal]} competitorIds={["comp-2"]} />);
    expect(leaveCompetitorMock).toHaveBeenCalledWith("comp-1");
    expect(joinCompetitorMock).toHaveBeenCalledWith("comp-2");
  });

  it("does not churn rooms on a new array with the same ids (e.g. router.refresh() re-rendering the parent)", () => {
    const { rerender } = render(
      <SignalFeed signals={[signal]} competitorIds={["comp-1", "comp-2"]} />
    );
    joinCompetitorMock.mockClear();
    leaveCompetitorMock.mockClear();
    // A brand-new array, same values, same order — exactly what a Server Component parent
    // produces on re-render. Must not leave/rejoin.
    rerender(<SignalFeed signals={[signal]} competitorIds={["comp-1", "comp-2"]} />);
    expect(joinCompetitorMock).not.toHaveBeenCalled();
    expect(leaveCompetitorMock).not.toHaveBeenCalled();
  });

  it("does not churn rooms when the same ids arrive in a different order", () => {
    const { rerender } = render(
      <SignalFeed signals={[signal]} competitorIds={["comp-1", "comp-2"]} />
    );
    joinCompetitorMock.mockClear();
    leaveCompetitorMock.mockClear();
    rerender(<SignalFeed signals={[signal]} competitorIds={["comp-2", "comp-1"]} />);
    expect(joinCompetitorMock).not.toHaveBeenCalled();
    expect(leaveCompetitorMock).not.toHaveBeenCalled();
  });
});
