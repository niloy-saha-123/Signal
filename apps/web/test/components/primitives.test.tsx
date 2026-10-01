import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EmptyState,
  Probability,
  ProbabilityBar,
  SourceChip,
  Tabs,
} from "../../components/ui/primitives";
import { Toaster, toast } from "../../components/ui/toast";

describe("primitives", () => {
  it("states a probability as a percentage for assistive tech", () => {
    render(<Probability value={0.724} />);
    expect(screen.getByRole("img", { name: "72 percent likely" })).toBeInTheDocument();
  });

  it("clamps out-of-range probabilities instead of rendering 140%", () => {
    render(<ProbabilityBar value={1.4} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("labels known and unknown sources by name", () => {
    render(
      <>
        <SourceChip source="postings" />
        <SourceChip source="carrier-pigeon" />
      </>
    );
    expect(screen.getByText("Newsroom")).toBeInTheDocument();
    expect(screen.getByText("carrier-pigeon")).toBeInTheDocument();
  });

  it("renders an empty state with its next action", () => {
    render(<EmptyState title="Nothing yet" note="Add one." action={<button>Add</button>} />);
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("marks the selected tab and reports changes", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="Filter"
        active="open"
        onChange={onChange}
        items={[
          { value: "open", label: "Open", count: 3 },
          { value: "settled", label: "Settled" },
        ]}
      />
    );
    expect(screen.getByRole("tab", { name: /Open/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Settled" }));
    expect(onChange).toHaveBeenCalledWith("settled");
  });
});

describe("toast", () => {
  afterEach(() => vi.useRealTimers());

  it("shows a message and clears it after its time", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => toast("Competitor added", "success"));
    expect(screen.getByRole("status")).toHaveTextContent("Competitor added");
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps at most three visible", () => {
    render(<Toaster />);
    act(() => {
      for (let i = 0; i < 5; i++) toast(`t${i}`);
    });
    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.queryByText("t0")).toBeNull();
  });
});
