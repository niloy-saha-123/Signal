import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ForecastClient } from "../../app/(app)/forecast/forecast-client";
import { ScorecardClient } from "../../app/(app)/scorecard/scorecard-client";
import type { Calibration, PredictionRow } from "../../lib/api";

const EMPTY: Calibration = { resolved_count: 0, brier: null, baseline_brier: 0.25, buckets: [] };

function prediction(overrides: Partial<PredictionRow>): PredictionRow {
  return {
    id: "p",
    workspace_id: "w",
    competitor_id: "k",
    statement: "Statement",
    pattern_type: "product_launch",
    probability: 0.6,
    resolves_at: "2026-12-01T00:00:00.000Z",
    resolution_criteria: { kind: "pricing_change", direction: "any" },
    evidence_cluster_ids: [],
    evidence_count: 5,
    status: "open",
    resolved_at: null,
    resolution_note: null,
    resolution_evidence_urls: [],
    brier_score: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as PredictionRow;
}

const competitors = [
  { id: "k", name: "Kestrel" },
  { id: "l", name: "Lumen" },
];

describe("ForecastClient", () => {
  it("never shows a Brier number before anything has settled", () => {
    render(<ForecastClient predictions={[]} calibration={EMPTY} competitors={[]} />);
    expect(screen.getByText("No score until something settles")).toBeInTheDocument();
    expect(screen.queryByText("0.000")).toBeNull();
    expect(screen.getByText("No open forecasts")).toBeInTheDocument();
  });

  it("orders open forecasts by the date they settle", () => {
    render(
      <ForecastClient
        calibration={EMPTY}
        competitors={competitors}
        predictions={[
          prediction({ id: "late", statement: "Later", resolves_at: "2027-01-10T00:00:00.000Z" }),
          prediction({ id: "soon", statement: "Sooner", resolves_at: "2026-11-01T00:00:00.000Z" }),
        ]}
      />
    );
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.filter((h) => h?.startsWith("/forecast/"))).toEqual(["/forecast/soon", "/forecast/late"]);
  });

  it("filters by competitor and offers to clear an empty filter", () => {
    render(
      <ForecastClient
        calibration={EMPTY}
        competitors={competitors}
        predictions={[prediction({ id: "a", competitor_id: "k", statement: "Kestrel thing" })]}
      />
    );
    fireEvent.change(screen.getByLabelText("Competitor"), { target: { value: "l" } });
    expect(screen.getByText("Nothing matches these filters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Kestrel thing")).toBeInTheDocument();
  });

  it("shows settled forecasts with their outcome", () => {
    render(
      <ForecastClient
        calibration={{ ...EMPTY, resolved_count: 1, brier: 0.09 }}
        competitors={competitors}
        predictions={[
          prediction({ id: "h", status: "hit", statement: "It shipped", resolution_note: "Released", resolved_at: "2026-09-22T00:00:00.000Z" }),
        ]}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /Settled/ }));
    const card = screen.getByText("It shipped").closest("a")!;
    expect(within(card).getByText("Hit")).toBeInTheDocument();
    expect(screen.getByText("0.090")).toBeInTheDocument();
  });
});

describe("ScorecardClient", () => {
  it("shows no number at all for an empty track record", () => {
    render(<ScorecardClient calibration={EMPTY} nextResolution={null} openCount={0} />);
    expect(screen.getByText("No track record yet")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/0\.000/);
  });

  it("says plainly when Signal is not beating the coin flip", () => {
    render(
      <ScorecardClient
        calibration={{ resolved_count: 4, brier: 0.31, baseline_brier: 0.25, buckets: [] }}
        nextResolution={null}
        openCount={0}
      />
    );
    expect(screen.getByText(/beating the coin-flip baseline yet/)).toBeInTheDocument();
    expect(screen.getByText(/not enough to tell skill from luck/)).toBeInTheDocument();
  });
});
