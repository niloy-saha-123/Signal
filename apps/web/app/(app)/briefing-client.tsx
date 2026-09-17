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
    <div className="flex flex-col gap-1 rounded-[1.4rem] border border-studio-line bg-studio-paper p-5">
      <p className="text-sm font-semibold text-studio-muted">{label}</p>
      <p className="font-display text-3xl font-semibold tabular-nums text-studio-ink">{value}</p>
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
          <p className="text-sm font-semibold text-studio-muted">{dateStr}</p>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
            Overnight briefing
          </h1>
        </div>
        <section className="relative overflow-hidden rounded-3xl border border-studio-line bg-studio-paper px-7 py-12 sm:px-12 sm:py-16">
          <div className="absolute top-0 left-0 h-1 w-full bg-studio-action" />
          <h2 className="max-w-xl font-display text-3xl font-bold tracking-[-0.035em] text-studio-ink">
            Your briefing starts with a competitor.
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-studio-muted">
            Add the first company you want Signal to monitor. Once evidence arrives, this
            workspace will organize movements, scores, alerts, and source-backed analysis.
          </p>
          <Link
            href="/discovery"
            className="mt-7 inline-flex min-h-11 items-center rounded-full bg-studio-ink px-5 text-sm font-bold text-white transition-colors hover:bg-[#071625]"
          >
            Add your first competitor
          </Link>
        </section>
      </div>
    );
  }

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      pricing: "bg-studio-action-soft text-studio-action",
      product: "bg-[#fde8ee] text-[#9b3858]",
      hiring: "bg-emerald-100 text-emerald-700",
      content: "bg-studio-sky-soft text-studio-ink",
      default: "bg-studio-sky-soft text-studio-muted",
    };
    return colors[category] || colors.default;
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-studio-muted">{dateStr}</p>
        <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
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
        <div className="flex flex-col gap-4 rounded-[1.6rem] border border-studio-line bg-studio-paper p-6">
          <p className="text-sm font-bold text-studio-ink">Highest-signal movement</p>
          {highestScore > 0 ? (
            <>
              <p className="font-display text-5xl font-semibold tabular-nums text-studio-ink">
                {highestScore}
              </p>
              <p className="text-sm font-bold text-studio-action">
                {highestScoreCompetitor} · {highestScoreDelta > 0 ? "+" : ""}
                {highestScoreDelta} vs last week
              </p>
              {movements.length > 0 && (
                <p className="text-sm leading-relaxed text-studio-muted">{movements[0].detail}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-studio-muted">
              No signal data yet. Add competitors to start tracking.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4 rounded-[1.6rem] border border-studio-line bg-studio-paper p-6">
          <p className="text-sm font-bold text-studio-ink">View</p>
          <div className="inline-flex w-fit gap-2">
            {[
              { value: "today" as const, label: "Today" },
              { value: "7days" as const, label: "7 days" },
              { value: "30days" as const, label: "30 days" },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setTimeFilter(option.value)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                  timeFilter === option.value
                    ? "bg-studio-ink text-white"
                    : "bg-studio-paper text-studio-muted hover:bg-studio-sky-soft"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-sm leading-relaxed text-studio-muted">
            {movements.length === 0
              ? "No movements recorded in this window."
              : `${movements.length} movement${movements.length === 1 ? "" : "s"} across your tracked competitors.`}
          </p>
        </div>
      </div>

      {movements.length > 0 && (
        <div className="flex flex-col gap-4 rounded-[1.6rem] border border-studio-line bg-studio-paper p-6">
          <h2 className="text-sm font-bold text-studio-ink">The other movements</h2>
          <div className="flex flex-col divide-y divide-studio-line">
            {movements.slice(0, 4).map((movement) => (
              <div key={movement.id} className="flex gap-4 py-4 first:pt-0">
                <div className="w-24 shrink-0">
                  <p className="text-xs font-extrabold text-studio-ink">{movement.competitor}</p>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-studio-ink">{movement.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-studio-muted">
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