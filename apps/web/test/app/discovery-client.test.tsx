import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { resumeMock, triggerMock, toastMock, refreshMock } = vi.hoisted(() => ({
  resumeMock: vi.fn(),
  triggerMock: vi.fn(),
  toastMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, resumeDiscovery: resumeMock, triggerDiscovery: triggerMock };
});
vi.mock("@/components/ui/toast", () => ({ toast: toastMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { DiscoveryBoard, type DiscoveryEntity } from "../../app/(app)/discovery/discovery-client";

function entity(id: string, name: string, status: string): DiscoveryEntity {
  return {
    id,
    workspaceId: "ws-1",
    name,
    domain: `${name.toLowerCase()}.com`,
    relationshipType: "competitor",
    source: "discovered",
    confidence: 0.8,
    reason: `${name} sells to the same buyers.`,
    status,
  };
}

const entities = [
  entity("e1", "Rivalex", "candidate"),
  entity("e2", "Northstar", "confirmed"),
  entity("e3", "Paperloom", "dismissed"),
];

function suggested() {
  return screen.getByRole("list", { name: "Suggested" });
}

describe("DiscoveryBoard", () => {
  afterEach(() => vi.clearAllMocks());

  it("opens on suggestions with counts for each view", () => {
    render(<DiscoveryBoard entities={entities} />);
    expect(screen.getByRole("tab", { name: /Suggested\s*1/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Tracking\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Dismissed\s*1/ })).toBeInTheDocument();
    expect(within(suggested()).getByText("Rivalex")).toBeInTheDocument();
    expect(within(suggested()).getByText("Rivalex sells to the same buyers.")).toBeInTheDocument();
    expect(within(suggested()).getByText("80% match")).toBeInTheDocument();
  });

  it("moves a candidate to Tracking at once when tracked, then confirms", async () => {
    resumeMock.mockResolvedValue(undefined);
    render(<DiscoveryBoard entities={entities} />);
    fireEvent.click(within(suggested()).getByRole("button", { name: "Watch Rivalex" }));
    expect(screen.getByRole("tab", { name: /Tracking\s*2/ })).toBeInTheDocument();
    expect(screen.getByText("No suggestions waiting")).toBeInTheDocument();
    await waitFor(() => expect(resumeMock).toHaveBeenCalledWith("ws-1", "confirm"));
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining("Rivalex"), "success");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("puts the candidate back and says so when the decision fails", async () => {
    resumeMock.mockRejectedValue(new Error("boom"));
    render(<DiscoveryBoard entities={entities} />);
    fireEvent.click(within(suggested()).getByRole("button", { name: "Dismiss Rivalex" }));
    expect(screen.getByRole("tab", { name: /Dismissed\s*2/ })).toBeInTheDocument();
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining("Couldn't"), "error"));
    expect(within(suggested()).getByText("Rivalex")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Dismissed\s*1/ })).toBeInTheDocument();
  });

  it("shows tracked and dismissed companies in their own views", () => {
    render(<DiscoveryBoard entities={entities} />);
    fireEvent.click(screen.getByRole("tab", { name: /Tracking/ }));
    expect(screen.getByText("Northstar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Dismissed/ }));
    expect(screen.getByText("Paperloom")).toBeInTheDocument();
  });

  it("starts a new discovery sweep", async () => {
    triggerMock.mockResolvedValue({});
    render(<DiscoveryBoard entities={[]} />);
    expect(screen.getByText("No suggestions waiting")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Find competitors" })[0]!);
    await waitFor(() => expect(triggerMock).toHaveBeenCalled());
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining("Looking"), "success");
  });
});
