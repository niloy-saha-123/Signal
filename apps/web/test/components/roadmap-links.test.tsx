import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, updateMock, deleteMock, getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("../../lib/api", () => {
  class ApiError extends Error {
    constructor(public status: number) {
      super(`status ${status}`);
    }
  }
  return { ApiError, createRoadmapLink: createMock, updateRoadmapLink: updateMock, deleteRoadmapLink: deleteMock, getPrediction: getMock };
});

import { RoadmapLinks } from "../../components/forecast/RoadmapLinks";
import { ApiError, type RoadmapLink } from "../../lib/api";

function link(n: number, overrides: Partial<RoadmapLink> = {}): RoadmapLink {
  return {
    id: `l${n}`,
    workspace_id: "w",
    prediction_id: "p1",
    title: `Item ${n}`,
    url: `https://tracker.example.com/${n}`,
    stance: "watching",
    created_by: null,
    created_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const err = (status: number) => new (ApiError as unknown as new (s: number) => Error)(status);

beforeEach(() => {
  createMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
  getMock.mockReset();
  getMock.mockRejectedValue(new Error("offline"));
});

describe("RoadmapLinks", () => {
  it("renders each link as a safe external anchor with its host", () => {
    render(<RoadmapLinks predictionId="p1" initialLinks={[link(1)]} />);
    const a = screen.getByRole("link", { name: "Item 1" });
    expect(a).toHaveAttribute("href", "https://tracker.example.com/1");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("tracker.example.com")).toBeInTheDocument();
  });

  it("shows the current stance and saves a change", async () => {
    updateMock.mockResolvedValue(link(1, { stance: "accelerate" }));
    render(<RoadmapLinks predictionId="p1" initialLinks={[link(1)]} />);
    const select = screen.getByRole("combobox", { name: "Stance for Item 1" });
    expect(select).toHaveValue("watching");
    fireEvent.change(select, { target: { value: "accelerate" } });
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("p1", "l1", { stance: "accelerate" }));
    expect(select).toHaveValue("accelerate");
  });

  it("removes a row", async () => {
    deleteMock.mockResolvedValue(undefined);
    render(<RoadmapLinks predictionId="p1" initialLinks={[link(1)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Item 1" }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("p1", "l1"));
    expect(screen.queryByText("Item 1")).toBeNull();
  });

  it("adds a link with the default stance", async () => {
    createMock.mockResolvedValue(link(2, { title: "New one", url: "https://a.example.org/x" }));
    render(<RoadmapLinks predictionId="p1" initialLinks={[]} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New one" } });
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://a.example.org/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith("p1", { title: "New one", url: "https://a.example.org/x", stance: "watching" })
    );
    expect(await screen.findByRole("link", { name: "New one" })).toBeInTheDocument();
  });

  it.each([
    [409, "This forecast already has 10 roadmap links."],
    [400, "Enter a title and an http(s) link."],
    [500, "Couldn't save. Try again."],
  ])("shows the add error for %i", async (status, message) => {
    createMock.mockRejectedValue(err(status));
    render(<RoadmapLinks predictionId="p1" initialLinks={[]} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://a.example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("reverts a failed stance change", async () => {
    updateMock.mockRejectedValue(err(404));
    render(<RoadmapLinks predictionId="p1" initialLinks={[link(1)]} />);
    const select = screen.getByRole("combobox", { name: "Stance for Item 1" });
    fireEvent.change(select, { target: { value: "deprioritize" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Try again.");
    expect(select).toHaveValue("watching");
  });

  it("restores a row whose removal failed", async () => {
    deleteMock.mockRejectedValue(err(500));
    render(<RoadmapLinks predictionId="p1" initialLinks={[link(1), link(2)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Item 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Try again.");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Item 1")).toBeInTheDocument();
  });

  it("treats a 404 on remove as already gone: no error, re-synced", async () => {
    deleteMock.mockRejectedValue(err(404));
    getMock.mockResolvedValue({ roadmap_links: [link(2)] });
    render(<RoadmapLinks predictionId="p1" initialLinks={[link(1), link(2)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Item 1" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("p1"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Item 1")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps the row removed on a 404 even if the re-sync fails", async () => {
    deleteMock.mockRejectedValue(err(404));
    render(<RoadmapLinks predictionId="p1" initialLinks={[link(1), link(2)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Item 1" }));
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Item 1")).toBeNull();
  });

  it("re-syncs from the server after a 409 on add", async () => {
    createMock.mockRejectedValue(err(409));
    getMock.mockResolvedValue({ roadmap_links: [link(1), link(2)] });
    render(<RoadmapLinks predictionId="p1" initialLinks={[link(1)]} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://a.example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already has 10 roadmap links");
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(getMock).toHaveBeenCalledWith("p1");
  });

  it("disables the add form while a request is in flight", async () => {
    let resolve!: (v: unknown) => void;
    createMock.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<RoadmapLinks predictionId="p1" initialLinks={[]} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://a.example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByLabelText("Title")).toBeDisabled());
    expect(screen.getByLabelText("URL")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "New link stance" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    resolve(link(1));
    await waitFor(() => expect(screen.getByLabelText("Title")).toBeEnabled());
  });

  it("re-syncs from the server after a 404 on a stance change", async () => {
    updateMock.mockRejectedValue(err(404));
    getMock.mockResolvedValue({ roadmap_links: [link(1, { stance: "accelerate" })] });
    render(<RoadmapLinks predictionId="p1" initialLinks={[link(1)]} />);
    const select = screen.getByRole("combobox", { name: "Stance for Item 1" });
    fireEvent.change(select, { target: { value: "deprioritize" } });
    await waitFor(() => expect(select).toHaveValue("accelerate"));
  });

  it("disables the stance select while a mutation is in flight", async () => {
    let resolve!: (v: unknown) => void;
    updateMock.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<RoadmapLinks predictionId="p1" initialLinks={[link(1)]} />);
    const select = screen.getByRole("combobox", { name: "Stance for Item 1" });
    fireEvent.change(select, { target: { value: "accelerate" } });
    await waitFor(() => expect(select).toBeDisabled());
    resolve(link(1, { stance: "accelerate" }));
    await waitFor(() => expect(select).toBeEnabled());
  });

  it("hides the add form at the 10 link limit", () => {
    render(<RoadmapLinks predictionId="p1" initialLinks={Array.from({ length: 10 }, (_, i) => link(i))} />);
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("shows the empty state", () => {
    render(<RoadmapLinks predictionId="p1" initialLinks={[]} />);
    expect(screen.getByText("Link the roadmap items this forecast affects.")).toBeInTheDocument();
  });

  it("hides controls when read-only", () => {
    render(<RoadmapLinks predictionId="p1" initialLinks={[link(1)]} readOnly />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
