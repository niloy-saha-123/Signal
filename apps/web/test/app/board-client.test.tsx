import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Board } from "../../app/(app)/board-client";

const cards = [{ id: "comp-1", name: "Acme", score: 72, x: 0, y: 0 }];

describe("Board", () => {
  it("renders a card per competitor with its score", () => {
    render(<Board initialCards={cards} />);
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
  });

  it("repositions a card after a drag-and-drop interaction", () => {
    render(<Board initialCards={cards} />);
    const card = screen.getByTestId("board-card-comp-1");
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => "comp-1") };
    fireEvent.dragStart(card, { clientX: 20, clientY: 30, dataTransfer });
    const canvas = screen.getByTestId("board-canvas");
    fireEvent.drop(canvas, { clientX: 120, clientY: 150, dataTransfer });
    expect(card.style.left).toBe("100px");
    expect(card.style.top).toBe("120px");
  });
});
