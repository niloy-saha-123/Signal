"use client";
import { useState } from "react";
import Link from "next/link";
import type { Competitor, DashboardSummary } from "@/lib/api";

type Movement = {
  id: string;
  competitor: string;
  title: string;
  detail: string;
  category: string;
  timestamp: string;
  confidence: number;
};

type Props = {
  summary: DashboardSummary | null;
  highestScore: number;
  highestScoreDelta: number;
  highestScoreCompetitor: string;
  movements: Movement[];
  competitors: Competitor[];
};

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface p-5">
      <p className="text-sm font-semibold text-ink-secondary">{label}</p>
      <p className=" text-3xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

export function BriefingClient({
  summary,
  highestScore,
  highestScoreDelta,
  highestScoreCompetitor,
  movements,
  competitors,
}: Props) {
  const [timeFilter, setTimeFilter] = useState<"today" | "7days" | "30days">("today");

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  if (competitors.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-ink-secondary">{dateStr}</p>
          <h1 className=" text-4xl font-semibold tracking-[-0.035em] text-ink">
            Overnight briefing
          </h1>
        </div>
        <section className="relative overflow-hidden rounded-[10px] border border-line bg-surface px-7 py-12 sm:px-12 sm:py-16">
          <div className="absolute top-0 left-0 h-1 w-full bg-accent" />
          <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.035em] text-ink">
            Your briefing starts with a competitor.
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-secondary">
            Add the first company you want Signal to monitor. Once evidence arrives, this
            workspace will organize movements, scores, alerts, and source-backed analysis.
          </p>
          <Link
            href="/discovery"
            className="mt-7 inline-flex min-h-11 items-center rounded-lg bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Add your first competitor
          </Link>
        </section>
      </div>
    );
  }

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      pricing: "bg-accent-tint text-accent",
      product: "bg-[var(--color-tint-sky)] text-ink",
      hiring: "bg-[var(--color-tint-sage)] text-ink",
      content: "bg-surface-sunken text-ink",
      default: "bg-surface-sunken text-ink-secondary",
    };
    return colors[category] || colors.default;
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-ink-secondary">{dateStr}</p>
        <h1 className=" text-4xl font-semibold tracking-[-0.035em] text-ink">
          Overnight briefing
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Competitors tracked" value={summary?.competitors_tracked ?? 0} />
        <StatTile label="Signals this week" value={summary?.signals_this_week ?? 0} />
        <StatTile label="Open alerts" value={summary?.open_alerts ?? 0} />
        <StatTile label="Pending candidates" value={summary?.pending_candidates ?? 0} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-6">
          <p className="text-sm font-semibold text-ink">Highest-signal movement</p>
          {highestScore > 0 ? (
            <>
              <p className=" text-5xl font-semibold tabular-nums text-ink">
                {highestScore}
              </p>
              <p className="text-sm font-semibold text-accent">
                {highestScoreCompetitor} · {highestScoreDelta > 0 ? "+" : ""}
                {highestScoreDelta} vs last week
              </p>
              {movements.length > 0 && (
                <p className="text-sm leading-relaxed text-ink-secondary">{movements[0].detail}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-secondary">
              No signal data yet. Add competitors to start tracking.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-6">
          <p className="text-sm font-semibold text-ink">View</p>
          <div className="inline-flex w-fit gap-2">
            {[
              { value: "today" as const, label: "Today" },
              { value: "7days" as const, label: "7 days" },
              { value: "30days" as const, label: "30 days" },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setTimeFilter(option.value)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  timeFilter === option.value
                    ? "bg-accent text-white"
                    : "bg-surface text-ink-secondary hover:bg-surface-sunken"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-sm leading-relaxed text-ink-secondary">
            {movements.length === 0
              ? "No movements recorded in this window."
              : `${movements.length} movement${movements.length === 1 ? "" : "s"} across your tracked competitors.`}
          </p>
        </div>
      </div>

      {movements.length > 0 && (
        <div className="flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-6">
          <h2 className="text-sm font-semibold text-ink">The other movements</h2>
          <div className="flex flex-col divide-y divide-line">
            {movements.slice(0, 4).map((movement) => (
              <div key={movement.id} className="flex gap-4 py-4 first:pt-0">
                <div className="w-24 shrink-0">
                  <p className="text-xs font-extrabold text-ink">{movement.competitor}</p>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-ink">{movement.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
                    {movement.detail}
                  </p>
                </div>
                <div className="shrink-0">
                  <span
                    className={`inline-block rounded-full px-2.5 py-1 text-xs font-extrabold ${getCategoryColor(movement.category)}`}
                  >
                    {movement.category}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}