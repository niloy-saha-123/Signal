"use client";

import { useMemo, useState } from "react";
import { ForecastAreaTabs, ForecastCard } from "@/components/forecast/parts";
import { EmptyState, LinkButton, Metric, PageHeader, Select, Tabs } from "@/components/ui/primitives";
import type { Calibration, PredictionRow } from "@/lib/api";
import { formatDate, patternLabel } from "@/lib/format";

type View = "open" | "settled";

export function ForecastClient({
  predictions,
  calibration,
  competitors,
}: {
  predictions: PredictionRow[];
  calibration: Calibration;
  competitors: Array<{ id: string; name: string }>;
}) {
  const [view, setView] = useState<View>("open");
  const [competitorId, setCompetitorId] = useState("all");
  const [pattern, setPattern] = useState("all");

  const names = useMemo(() => new Map(competitors.map((c) => [c.id, c.name])), [competitors]);

  const open = useMemo(
    () =>
      predictions
        .filter((p) => p.status === "open")
        .sort((a, b) => new Date(a.resolves_at).getTime() - new Date(b.resolves_at).getTime()),
    [predictions]
  );
  const settled = useMemo(
    () =>
      predictions
        .filter((p) => p.status !== "open")
        .sort(
          (a, b) =>
            new Date(b.resolved_at ?? b.created_at).getTime() - new Date(a.resolved_at ?? a.created_at).getTime()
        ),
    [predictions]
  );

  const patterns = useMemo(() => Array.from(new Set(predictions.map((p) => p.pattern_type))).sort(), [predictions]);

  const visible = (view === "open" ? open : settled).filter(
    (p) => (competitorId === "all" || p.competitor_id === competitorId) && (pattern === "all" || p.pattern_type === pattern)
  );

  const scored = calibration.resolved_count > 0 && calibration.brier !== null;
  const nextStep =
    competitors.length === 0 ? (
      <LinkButton href="/board" variant="primary" size="sm">
        Add a competitor
      </LinkButton>
    ) : (
      <LinkButton href="/intel" size="sm">
        See the evidence so far
      </LinkButton>
    );
  const filtered = competitorId !== "all" || pattern !== "all";

  return (
    <div>
      <PageHeader
        title="Forecasts"
        description="What Signal expects each competitor to do next, with the date it gets checked. Every one is scored when it settles, right or wrong."
        action={<ForecastAreaTabs active="forecasts" />}
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[14px] bg-sky p-5">
          <Metric value={String(open.length)} label="Open forecasts" size="md" />
        </div>
        <div className="rounded-[14px] bg-sky p-5">
          <Metric value={String(calibration.resolved_count)} label="Settled and scored" size="md" />
        </div>
        <div className="rounded-[14px] bg-sky p-5">
          {scored ? (
            <Metric value={calibration.brier!.toFixed(3)} label={`Brier score (coin flip ${calibration.baseline_brier.toFixed(2)})`} size="md" />
          ) : (
            <Metric value="—" label="No score until something settles" size="md" tone="muted" />
          )}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Forecast status"
          active={view}
          onChange={setView}
          items={[
            { value: "open", label: "Open", count: open.length },
            { value: "settled", label: "Settled", count: settled.length },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Select label="Competitor" value={competitorId} onChange={setCompetitorId}>
            <option value="all">All competitors</option>
            {competitors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Kind of move" value={pattern} onChange={setPattern}>
            <option value="all">Every kind of move</option>
            {patterns.map((p) => (
              <option key={p} value={p}>
                {patternLabel(p)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {visible.length === 0 ? (
        filtered ? (
          <EmptyState
            compact
            title="Nothing matches these filters"
            action={
              <button
                type="button"
                onClick={() => {
                  setCompetitorId("all");
                  setPattern("all");
                }}
                className="text-[14px] font-semibold text-accent hover:underline"
              >
                Clear filters
              </button>
            }
          />
        ) : view === "open" ? (
          <EmptyState
            title="No open forecasts"
            note="Signal only forecasts once several independent signals agree. Below that bar it stays quiet rather than guessing, which is most days for most competitors."
            action={nextStep}
          />
        ) : (
          <EmptyState
            title="Nothing has settled yet"
            note={
              open[0]
                ? `The first open forecast settles ${formatDate(open[0].resolves_at)}. Hits, misses and unresolved windows all show up here.`
                : "Forecasts settle on their date against the evidence collected. Hits, misses and unresolved windows all show up here."
            }
            action={open[0] ? undefined : nextStep}
          />
        )
      ) : (
        <ul className="space-y-3">
          {visible.map((prediction) => (
            <ForecastCard
              key={prediction.id}
              prediction={prediction}
              competitor={names.get(prediction.competitor_id) ?? "Unknown competitor"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
