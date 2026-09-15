// apps/web/app/radar/[id]/page.tsx
// Competitor radar — Signal Score over time, mention volume trend, sentiment trajectory,
// hiring velocity by department. No score/trend-history endpoint exists yet (see
// 00-overview.md's Discovered Gaps) — TrendChart/HiringChart get empty arrays until one does.
import { notFound } from "next/navigation";
import { ApiError, getCompetitor, getCompetitorScore } from "../../../lib/api";
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

  const score = await getCompetitorScore(id).catch(() => null);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-slate-900">{competitor.name}</h1>
      {score ? (
        <SignalScoreCard
          competitorName={competitor.name}
          score={score.score}
          delta7d={score.delta_7d}
          history={[]}
        />
      ) : (
        <p className="text-sm text-slate-400">No score yet.</p>
      )}
      <TrendChart data={[]} />
      <HiringChart data={[]} />
    </div>
  );
}
