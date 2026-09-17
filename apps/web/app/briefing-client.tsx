"use client";
import { useState } from "react";
import type { Competitor } from "../lib/api";

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
  highestScore: number;
  highestScoreDelta: number;
  highestScoreCompetitor: string;
  movements: Movement[];
  competitors: Competitor[];
};

export function BriefingClient({
  highestScore,
  highestScoreDelta,
  highestScoreCompetitor,
  movements,
}: Props) {
  const [timeFilter, setTimeFilter] = useState<"today" | "7days" | "30days">("today");

  // Format date for kicker
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Category colors
  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      pricing: "bg-blue-100 text-blue-700",
      product: "bg-rose-100 text-rose-700",
      hiring: "bg-emerald-100 text-emerald-700",
      content: "bg-violet-100 text-violet-700",
      default: "bg-slate-100 text-slate-600",
    };
    return colors[category] || colors.default;
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <p className="font-sans text-sm font-semibold text-slate-600">{dateStr}</p>
        <h1 className="font-serif text-4xl font-semibold text-slate-900">Overnight briefing</h1>
      </div>

      {/* Filter Pills */}
      <div className="inline-flex gap-2">
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
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Hero Metrics */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        {/* Signal Score Card */}
        <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm">
          <p className="font-sans text-sm font-bold text-slate-900">Highest-signal movement</p>
          <p className="font-serif text-5xl font-semibold text-slate-900">{highestScore}</p>
          <p className="font-sans text-sm font-bold text-red-600">
            {highestScoreCompetitor} · {highestScoreDelta > 0 ? "+" : ""}
            {highestScoreDelta} vs last week
          </p>
          <p className="font-sans text-sm leading-relaxed text-slate-600">
            Usage-based pricing went live 3 days ago. That is the first pricing change in their
            public changelog this year.
          </p>
        </div>

        {/* Volume Chart Card (placeholder) */}
        <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm">
          <p className="font-sans text-sm font-bold text-slate-900">Signal volume</p>
          <div className="flex h-24 items-end justify-between gap-2">
            {[40, 52, 48, 56, 64, 60, 88].map((height, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className={`w-full rounded-t-md ${i === 6 ? "bg-indigo-600" : "bg-slate-200"}`}
                  style={{ height: `${height}%` }}
                />
                <span className="text-xs text-slate-400">{"FSSMTTW"[i]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Movements List */}
      <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-sans text-sm font-bold text-slate-900">The other two</h2>
        <div className="flex flex-col divide-y divide-slate-200">
          {movements.slice(0, 2).map((movement) => (
            <div key={movement.id} className="flex gap-4 py-4 first:pt-0">
              <div className="w-24 shrink-0">
                <p className="font-sans text-xs font-extrabold text-slate-900">
                  {movement.competitor}
                </p>
              </div>
              <div className="flex-1">
                <p className="font-sans text-sm font-semibold text-slate-900">{movement.title}</p>
                <p className="mt-1 font-sans text-sm leading-relaxed text-slate-600">
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
    </div>
  );
}
