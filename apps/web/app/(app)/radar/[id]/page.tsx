// Competitor radar — Signal Score over time, mention volume trend, sentiment trajectory,
// hiring velocity by department. GET /:id/scores backs the sparkline; GET /:id/trend and
// GET /:id/hiring back the other panels.
import { notFound } from "next/navigation";
import {
  ApiError,
  getCompetitor,
  getCompetitorHiring,
  getCompetitorScore,
  getCompetitorScoreHistory,
  getCompetitorTrend,
} from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { SignalScoreCard } from "@/components/SignalScoreCard";
import { TrendChart } from "@/components/TrendChart";
import { HiringChart } from "@/components/HiringChart";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { AnalyzeButton } from "@/components/AnalyzeButton";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getOptionalAccessToken();

  let competitor;
  try {
    competitor = await getCompetitor(id, token);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 401)) notFound();
    throw error;
  }

  const [score, history, trend, hiring] = await Promise.all([
    getCompetitorScore(id, token).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return null;
      console.error("Failed to fetch competitor score", { competitorId: id, error });
      return null;
    }),
    getCompetitorScoreHistory(id, 90, token).catch(() => []),
    getCompetitorTrend(id, 30, token).catch(() => []),
    getCompetitorHiring(id, 30, token).catch(() => []),
  ]);

  const scoreExportRows = history.map((row) => ({
    date: row.computed_at,
    score: row.score,
    delta_7d: row.delta_7d ?? "",
    delta_30d: row.delta_30d ?? "",
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className=" text-4xl font-semibold tracking-[-0.035em] text-ink">
            {competitor.name}
          </h1>
          <p className="text-sm text-ink-secondary">Signal Score, trend, and hiring over time.</p>
        </div>
        <div className="flex items-center gap-3">
          <AnalyzeButton competitorId={competitor.id} />
          <ExportCsvButton
            rows={scoreExportRows}
            columns={[
              { key: "date", label: "Date" },
              { key: "score", label: "Signal Score" },
              { key: "delta_7d", label: "Δ 7d" },
              { key: "delta_30d", label: "Δ 30d" },
            ]}
            filename={`${competitor.name.toLowerCase().replace(/\s+/g, "-")}-score.csv`}
            label="Export score"
          />
        </div>
      </div>

      {score ? (
        <div className="rounded-xl bg-surface shadow-[var(--shadow-card)] p-6">
          <SignalScoreCard
            competitorName={competitor.name}
            score={score.score}
            delta7d={score.delta_7d}
            history={history.map((row) => ({ date: row.computed_at, score: row.score }))}
          />
        </div>
      ) : (
        <div className="rounded-xl bg-surface shadow-[var(--shadow-card)] p-12 text-center">
          <p className="text-sm text-ink-secondary">No score yet.</p>
        </div>
      )}

      <div className="rounded-xl bg-surface shadow-[var(--shadow-card)] p-6">
        <TrendChart data={trend} />
      </div>

      <div className="rounded-xl bg-surface shadow-[var(--shadow-card)] p-6">
        <HiringChart data={hiring} />
      </div>
    </div>
  );
}