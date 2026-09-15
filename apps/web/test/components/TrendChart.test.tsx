import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrendChart } from "../../components/TrendChart";

const data = [
  { date: "2026-09-01", mention_volume: 12, sentiment: -0.4, score: 58 },
  { date: "2026-09-08", mention_volume: 20, sentiment: 0.1, score: 65 },
  { date: "2026-09-14", mention_volume: 15, sentiment: 0.3, score: 72 },
];

describe("TrendChart", () => {
  it("renders a titled panel for each of the three metrics", () => {
    render(<TrendChart data={data} />);
    expect(screen.getByText("Mention volume")).toBeInTheDocument();
    expect(screen.getByText("Sentiment")).toBeInTheDocument();
    expect(screen.getByText("Signal Score")).toBeInTheDocument();
  });

  it("renders exactly three chart panels (never a fourth without re-reading the series-count ladder)", () => {
    const { container } = render(<TrendChart data={data} />);
    expect(container.querySelectorAll(".recharts-responsive-container")).toHaveLength(3);
  });
});
