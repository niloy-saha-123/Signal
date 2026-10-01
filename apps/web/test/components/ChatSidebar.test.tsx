import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listCompetitorsMock } = vi.hoisted(() => ({ listCompetitorsMock: vi.fn() }));

vi.mock("../../lib/api", () => ({
  listCompetitors: listCompetitorsMock,
  listChatThreads: vi.fn().mockResolvedValue([]),
  createChatThread: vi.fn(),
  getChatThreadMessages: vi.fn().mockResolvedValue([]),
  deleteChatThread: vi.fn(),
  listChatThreadCheckpoints: vi.fn().mockResolvedValue([]),
  regenerateChatThread: vi.fn(),
}));
vi.mock("../../lib/chat-stream", () => ({ streamChatResult: vi.fn(), resumeChatThread: vi.fn() }));

import { ChatSidebar } from "../../components/ChatSidebar";
import { askSignal } from "../../lib/ask";

describe("ChatSidebar", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    listCompetitorsMock.mockResolvedValue([{ id: "comp-1", is_active: true }]);
  });

  it("opens pre-filled (not sent) when something asks Signal about it", async () => {
    render(<ChatSidebar />);
    await waitFor(() => expect(listCompetitorsMock).toHaveBeenCalled());
    act(() => askSignal("What is Acme doing next?"));
    expect(screen.getByRole("dialog", { name: "Ask Signal" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Ask Signal a question…")).toHaveValue("What is Acme doing next?")
    );
  });

  it("closes on Escape and returns the launcher", async () => {
    render(<ChatSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Signal" }));
    expect(screen.getByRole("dialog", { name: "Ask Signal" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Ask Signal" })).toBeInTheDocument();
  });

  it("moves focus into the panel even before the composer exists, and back to the launcher on close", async () => {
    listCompetitorsMock.mockReturnValue(new Promise(() => {}));
    render(<ChatSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Signal" }));
    const dialog = screen.getByRole("dialog", { name: "Ask Signal" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask Signal" })));
  });

  it("gives a workspace with nothing to answer from a way to add a competitor", async () => {
    listCompetitorsMock.mockResolvedValue([]);
    render(<ChatSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Signal" }));
    expect(await screen.findByRole("link", { name: "Add a competitor" })).toHaveAttribute("href", "/board");
  });
});
