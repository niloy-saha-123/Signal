import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BriefingCard } from "../../components/BriefingCard";

describe("BriefingCard", () => {
  it("renders summary, evidence count, and recommended action", () => {
    render(
      <BriefingCard
        summary="Acme cut Pro tier pricing 20%."
        evidenceCount={4}
        recommendedAction="Review your own Pro tier pricing this week."
        onAction={() => {}}
      />
    );
    expect(screen.getByText("Acme cut Pro tier pricing 20%.")).toBeInTheDocument();
    expect(screen.getByText("4 pieces of evidence")).toBeInTheDocument();
    expect(
      screen.getByText("Review your own Pro tier pricing this week.")
    ).toBeInTheDocument();
  });

  it("uses singular 'piece' for an evidence count of 1", () => {
    render(
      <BriefingCard
        summary="s"
        evidenceCount={1}
        recommendedAction="a"
        onAction={() => {}}
      />
    );
    expect(screen.getByText("1 piece of evidence")).toBeInTheDocument();
  });

  it("calls onAction when the action button is clicked", () => {
    const onAction = vi.fn();
    render(
      <BriefingCard summary="s" evidenceCount={2} recommendedAction="a" onAction={onAction} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Take action" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders a custom action label when provided", () => {
    render(
      <BriefingCard
        summary="s"
        evidenceCount={2}
        recommendedAction="a"
        onAction={() => {}}
        actionLabel="Generate battlecard"
      />
    );
    expect(screen.getByRole("button", { name: "Generate battlecard" })).toBeInTheDocument();
  });
});
