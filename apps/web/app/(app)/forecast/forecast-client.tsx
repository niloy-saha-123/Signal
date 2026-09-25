"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  Metric,
  Num,
  PageHeader,
  ProbabilityBar,
  SectionLabel,
} from "@/components/ui/primitives";
import type { Calibration, PredictionRow } from "@/lib/api";

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const PATTERN_LABEL: Record<string, string> = {
  product_launch: "Product launch",
  pricing_change: "Pricing change",
  upmarket_pivot: "Upmarket pivot",
  platform_expansion: "Platform expansion",
  hiring_surge: "Hiring surge",
  deprecation: "Deprecation",
};

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function OutcomeBadge({ status }: { status: PredictionRow["status"] }) {
  if (status === "hit") return <Badge tone="hit">Hit</Badge>;
  if (status === "miss") return <Badge tone="miss">Miss</Badge>;
  if (status === "unresolved") return <Badge tone="unresolved">Unresolved</Badge>;
  if (status === "void") return <Badge tone="neutral">Void</Badge>;
  return <Badge tone="open">Open</Badge>;
}

function CompetitorName({
  id,
  competitors,
}: {
  id: string;
  competitors: Array<{ id: string; name: string }>;
}) {
  const name = competitors.find((c) => c.id === id)?.name ?? "Unknown competitor";
  return <span className="text-[13px] font-medium text-ink">{name}</span>;
}

function OpenPrediction({
  prediction,
  competitors,
}: {
  prediction: PredictionRow;
  competitors: Array<{ id: string; name: string }>;
}) {
  const days = daysUntil(prediction.resolves_at);

  return (
    <Card as="li" className="transition-colors hover:bg-surface-sunken">
      <Link href={`/forecast/${prediction.id}`} className="block p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <CompetitorName id={prediction.competitor_id} competitors={competitors} />
              <Badge tone="neutral">
                {PATTERN_LABEL[prediction.pattern_type] ?? prediction.pattern_type}
              </Badge>
            </div>
            <p className="text-[15px] leading-snug text-ink">{prediction.statement}</p>
          </div>
          <div className="shrink-0 text-right">
            <ProbabilityBar value={prediction.probability} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3 text-[12px] text-ink-muted">
          <span>
            Resolves <Num className="text-ink-secondary">{DATE.format(new Date(prediction.resolves_at))}</Num>
          </span>
          <span>
            {days > 0 ? (
              <>
                <Num className="text-ink-secondary">{days}</Num> day{days === 1 ? "" : "s"} out
              </>
            ) : (
              "Due now"
            )}
          </span>
          <span>
            Based on <Num className="text-ink-secondary">{prediction.evidence_count}</Num> signals
          </span>
        </div>
      </Link>
    </Card>
  );
}

function ResolvedPrediction({
  prediction,
  competitors,
}: {
  prediction: PredictionRow;
  competitors: Array<{ id: string; name: string }>;
}) {
  return (
    <Card as="li" className="transition-colors hover:bg-surface-sunken">
      <Link href={`/forecast/${prediction.id}`} className="block p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <CompetitorName id={prediction.competitor_id} competitors={competitors} />
              <OutcomeBadge status={prediction.status} />
            </div>
            <p className="text-[15px] leading-snug text-ink">{prediction.statement}</p>
            {prediction.resolution_note ? (
              <p className="mt-2 text-[13px] text-ink-secondary">{prediction.resolution_note}</p>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono tabular text-[15px] font-medium text-ink">
              {Math.round(prediction.probability * 100)}%
            </div>
            <div className="mt-0.5 text-[11px] text-ink-muted">said</div>
          </div>
        </div>
      </Link>
    </Card>
  );
}

type Filter = "open" | "resolved" | "all";

export function ForecastClient({
  predictions,
  calibration,
  competitors,
}: {
  predictions: PredictionRow[];
  calibration: Calibration;
  competitors: Array<{ id: string; name: string }>;
}) {
  const [filter, setFilter] = useState<Filter>("open");

  const open = useMemo(
    () =>
      predictions
        .filter((p) => p.status === "open")
        .sort(
          (a, b) => new Date(a.resolves_at).getTime() - new Date(b.resolves_at).getTime()
        ),
    [predictions]
  );

  const resolved = useMemo(
    () =>
      predictions
        .filter((p) => p.status !== "open")
        .sort(
          (a, b) =>
            new Date(b.resolved_at ?? b.created_at).getTime() -
            new Date(a.resolved_at ?? a.created_at).getTime()
        ),
    [predictions]
  );

  const scored = calibration.resolved_count > 0 && calibration.brier !== null;

  return (
    <div>
      <PageHeader
        title="Predictions"
        description="What Signal expects each competitor to do next, with the date it gets checked and the evidence behind it. Every one is scored when it resolves — whether it was right or not."
      />

      {/* The hero row leads with the track record, because a prediction is only
          worth reading if you know how often the thing making it is right. */}
      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        <div className="bg-[var(--color-tint-blue)] p-5">
          <Metric value={String(open.length)} label="Open" size="md" />
        </div>
        <div className="bg-[var(--color-tint-mist)] p-5">
          <Metric value={String(calibration.resolved_count)} label="Resolved" size="md" />
        </div>
        <div className="bg-[var(--color-tint-sage)] p-5">
          {scored ? (
            <Metric value={calibration.brier!.toFixed(3)} label="Brier score" size="md" />
          ) : (
            <Metric value="—" label="Brier score" size="md" tone="muted" />
          )}
        </div>
        <div className="bg-[var(--color-tint-flare)] p-5">
          <Metric
            value={calibration.baseline_brier.toFixed(2)}
            label="Coin-flip baseline"
            size="md"
            tone="muted"
          />
        </div>
      </div>

      {!scored ? (
        <p className="mb-8 rounded-lg border border-line bg-surface-sunken px-4 py-3 text-[13px] text-ink-secondary">
          No score yet — predictions have to resolve before an accuracy number means anything.
          The first one resolves{" "}
          {open.length > 0 ? (
            <Num className="text-ink">{DATE.format(new Date(open[0].resolves_at))}</Num>
          ) : (
            "once Signal has enough evidence to make one"
          )}
          .
        </p>
      ) : null}

      <div className="mb-4 flex gap-1">
        {(
          [
            ["open", `Open (${open.length})`],
            ["resolved", `Resolved (${resolved.length})`],
            ["all", "All"],
          ] as Array<[Filter, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={
              filter === value
                ? "rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white"
                : "rounded-md px-3 py-1.5 text-[13px] text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {filter !== "resolved" ? (
        <section className="mb-8">
          {filter === "all" ? <SectionLabel>Open</SectionLabel> : null}
          {open.length === 0 ? (
            <EmptyState
              title="No open predictions"
              note="Signal only forecasts above an evidence floor of five distinct signal clusters. Below that it stays quiet rather than guessing — which is most days, for most competitors."
            />
          ) : (
            <ul className="space-y-2">
              {open.map((prediction) => (
                <OpenPrediction
                  key={prediction.id}
                  prediction={prediction}
                  competitors={competitors}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {filter !== "open" ? (
        <section>
          {filter === "all" ? <SectionLabel>Resolved</SectionLabel> : null}
          {resolved.length === 0 ? (
            <EmptyState
              title="Nothing has resolved yet"
              note="Predictions are checked on their resolution date against evidence collected in the window. Hits and misses both appear here."
            />
          ) : (
            <ul className="space-y-2">
              {resolved.map((prediction) => (
                <ResolvedPrediction
                  key={prediction.id}
                  prediction={prediction}
                  competitors={competitors}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
