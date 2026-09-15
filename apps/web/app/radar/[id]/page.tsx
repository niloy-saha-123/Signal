// apps/web/app/radar/[id]/page.tsx
// Competitor radar — Signal Score over time, mention volume trend, sentiment trajectory,
// hiring velocity by department. GET /:id/scores backs SignalScoreCard's sparkline;
// GET /:id/trend and GET /:id/hiring back TrendChart's other two panels and HiringChart.
import { notFound } from "next/navigation";
import {
  ApiError,
  getCompetitor,
  getCompetitorHiring,
  getCompetitorScore,
  getCompetitorScoreHistory,
  getCompetitorTrend,
} from "../../../lib/api";
import { SignalScoreCard } from "../../../components/SignalScoreCard";
import { TrendChart } from "../../../components/TrendChart";
import { HiringChart } from "../../../components/HiringChart";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let competitor;
  try {
    competitor = await getCompetitor(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [score, history, trend, hiring] = await Promise.all([
    getCompetitorScore(id).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return null;
      console.error("Failed to fetch competitor score", { competitorId: id, error });
      return null;
    }),
    getCompetitorScoreHistory(id).catch((error) => {
      console.error("Failed to fetch competitor score history", { competitorId: id, error });
      return [];
    }),
    getCompetitorTrend(id).catch((error) => {
      console.error("Failed to fetch competitor trend", { competitorId: id, error });
      return [];
    }),
    getCompetitorHiring(id).catch((error) => {
      console.error("Failed to fetch competitor hiring", { competitorId: id, error });
      return [];
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-slate-900">{competitor.name}</h1>
      {score ? (
        <SignalScoreCard
          competitorName={competitor.name}
          score={score.score}
          delta7d={score.delta_7d}
          history={history.map((row) => ({ date: row.computed_at, score: row.score }))}
        />
      ) : (
        <p className="text-sm text-slate-400">No score yet.</p>
      )}
      <TrendChart data={trend} />
      <HiringChart data={hiring} />
    </div>
  );
}
