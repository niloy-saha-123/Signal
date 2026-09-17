import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertCreatedPayload } from "@signal/shared";

const { onAlertCreatedMock, unsubscribeMock } = vi.hoisted(() => ({
  onAlertCreatedMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock("../../lib/socket", () => ({
  onAlertCreated: onAlertCreatedMock,
}));

import { AlertBanner } from "../../components/AlertBanner";

const payload: AlertCreatedPayload = {
  id: "alert-1",
  competitor_id: "comp-1",
  pattern: "pricing_cut",
  confidence: 0.9,
};

describe("AlertBanner", () => {
  let capturedHandler: (payload: AlertCreatedPayload) => void;

  beforeEach(() => {
    onAlertCreatedMock.mockImplementation((handler: (payload: AlertCreatedPayload) => void) => {
      capturedHandler = handler;
      return unsubscribeMock;
    });
  });

  afterEach(() => {
    onAlertCreatedMock.mockReset();
    unsubscribeMock.mockReset();
  });

  it("renders nothing when no alerts have arrived", () => {
    const { container } = render(<AlertBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a banner when an alert:created event arrives", () => {
    render(<AlertBanner />);
    act(() => {
      capturedHandler(payload);
    });
    expect(screen.getByText("pricing cut")).toBeInTheDocument();
  });

  it("removes a banner when its dismiss button is clicked", () => {
    render(<AlertBanner />);
    act(() => {
      capturedHandler(payload);
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss alert" }));
    expect(screen.queryByText("pricing cut")).not.toBeInTheDocument();
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = render(<AlertBanner />);
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("caps the alert list instead of growing unbounded", () => {
    render(<AlertBanner />);
    act(() => {
      for (let i = 0; i < 25; i++) {
        capturedHandler({ ...payload, id: `alert-${i}`, pattern: `pattern-${i}` });
      }
    });
    expect(screen.getAllByRole("button", { name: "Dismiss alert" })).toHaveLength(5);
    // Newest-first, oldest dropped: the most recent 5 (alert-20..alert-24) survive.
    expect(screen.getByText("pattern-24")).toBeInTheDocument();
    expect(screen.queryByText("pattern-19")).not.toBeInTheDocument();
  });
});
