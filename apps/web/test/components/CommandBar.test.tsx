// apps/web/test/components/CommandBar.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandBar, type Command } from "../../components/CommandBar";

function makeCommands(overrides: Partial<Command>[] = []): Command[] {
  const base: Command[] = [
    { id: "chat", label: "Ask Signal a question", onSelect: vi.fn() },
    { id: "add-competitor", label: "Add competitor", onSelect: vi.fn() },
  ];
  return overrides.length > 0 ? (overrides as Command[]) : base;
}

describe("CommandBar", () => {
  it("is closed by default", () => {
    render(<CommandBar commands={makeCommands()} />);
    expect(screen.queryByPlaceholderText("Type a command…")).not.toBeInTheDocument();
  });

  it("opens on Cmd+K and closes on Escape", () => {
    render(<CommandBar commands={makeCommands()} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText("Type a command…")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Type a command…")).not.toBeInTheDocument();
  });

  it("filters commands by typed query", () => {
    render(<CommandBar commands={makeCommands()} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.change(screen.getByPlaceholderText("Type a command…"), {
      target: { value: "signal" },
    });
    expect(screen.getByText("Ask Signal a question")).toBeInTheDocument();
    expect(screen.queryByText("Add competitor")).not.toBeInTheDocument();
  });

  it("calls onSelect and closes when a command is clicked", () => {
    const onSelect = vi.fn();
    render(
      <CommandBar commands={[{ id: "chat", label: "Ask Signal a question", onSelect }]} />
    );
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByText("Ask Signal a question"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText("Type a command…")).not.toBeInTheDocument();
  });

  it("selects the active command on Enter", () => {
    const onSelect = vi.fn();
    render(
      <CommandBar commands={[{ id: "chat", label: "Ask Signal a question", onSelect }]} />
    );
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.keyDown(screen.getByPlaceholderText("Type a command…"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
