import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignalScoreCard } from "../../components/SignalScoreCard";
import { SCORE_DELTA_COLORS } from "../../lib/chart-colors";

const history = [
  { date: "2026-08-16", score: 60 },
  { date: "2026-08-23", score: 65 },
  { date: "2026-09-14", score: 72 },
];

describe("SignalScoreCard", () => {
  it("renders the competitor name and score", () => {
    render(
      <SignalScoreCard competitorName="Acme" score={72} delta7d={7} history={history} />
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
  });

  it("colors a rising delta as critical (more competitor threat) and shows an up mark", () => {
    render(
      <SignalScoreCard competitorName="Acme" score={72} delta7d={7} history={history} />
    );
    const mark = screen.getByText("▲");
    expect(mark).toHaveStyle({ color: SCORE_DELTA_COLORS.rising });
  });

  it("colors a falling delta as good (less competitor threat) and shows a down mark", () => {
    render(
      <SignalScoreCard competitorName="Acme" score={58} delta7d={-4} history={history} />
    );
    const mark = screen.getByText("▼");
    expect(mark).toHaveStyle({ color: SCORE_DELTA_COLORS.falling });
  });

  it("shows a neutral dash when delta7d is null", () => {
    render(
      <SignalScoreCard competitorName="Acme" score={60} delta7d={null} history={history} />
    );
    expect(screen.getByText("–")).toBeInTheDocument();
  });

  it("does not render a sparkline container when history is empty", () => {
    const { container } = render(
      <SignalScoreCard competitorName="Acme" score={60} delta7d={null} history={[]} />
    );
    expect(container.querySelector(".recharts-responsive-container")).toBeNull();
  });
});
