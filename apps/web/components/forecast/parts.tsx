import Link from "next/link";
import { Badge, Probability, Tabs } from "@/components/ui/primitives";
import type { PredictionRow } from "@/lib/api";
import { daysUntil, formatDate, patternLabel } from "@/lib/format";

export function OutcomeBadge({ status }: { status: PredictionRow["status"] }) {
  if (status === "hit") return <Badge tone="hit">Hit</Badge>;
  if (status === "miss") return <Badge tone="miss">Miss</Badge>;
  if (status === "unresolved") return <Badge tone="unresolved">Unresolved</Badge>;
  if (status === "void") return <Badge tone="neutral">Void</Badge>;
  return <Badge tone="open">Open</Badge>;
}

// Forecasts and the scorecard are one area with two views.
export function ForecastAreaTabs({ active }: { active: "forecasts" | "scorecard" }) {
  return (
    <Tabs
      label="Forecast views"
      active={active}
      items={[
        { value: "forecasts", label: "Forecasts", href: "/forecast" },
        { value: "scorecard", label: "Scorecard", href: "/scorecard" },
      ]}
    />
  );
}

export function ForecastCard({ prediction, competitor }: { prediction: PredictionRow; competitor: string }) {
  const open = prediction.status === "open";
  const days = daysUntil(prediction.resolves_at);
  return (
    <li>
      <Link
        href={`/forecast/${prediction.id}`}
        className="flex gap-5 rounded-[14px] border border-line bg-surface p-5 transition-colors hover:border-line-strong"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-bold text-ink">{competitor}</span>
            <Badge>{patternLabel(prediction.pattern_type)}</Badge>
            {open ? null : <OutcomeBadge status={prediction.status} />}
          </div>
          <p className="mt-2 text-[16px] leading-snug font-semibold text-ink">{prediction.statement}</p>
          {!open && prediction.resolution_note ? (
            <p className="mt-1.5 text-[14px] text-ink-secondary">{prediction.resolution_note}</p>
          ) : null}
          <p className="mt-3 text-[13px] text-ink-muted" suppressHydrationWarning>
            {open
              ? `${days > 0 ? `${days} day${days === 1 ? "" : "s"} left · ` : "Due now · "}settles ${formatDate(prediction.resolves_at)}`
              : `Settled ${formatDate(prediction.resolved_at ?? prediction.resolves_at)}`}
            {` · ${prediction.evidence_count} signal${prediction.evidence_count === 1 ? "" : "s"} behind it`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Probability value={prediction.probability} meter={open} />
          {open ? null : <p className="mt-1 text-[12px] text-ink-muted">said</p>}
        </div>
      </Link>
    </li>
  );
}
