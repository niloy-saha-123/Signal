// apps/web/app/page.tsx
// Home screen — competitor list with Signal Score per competitor, sparkline, and last alert
// timestamp.
import Link from "next/link";
import {
  ApiError,
  getCompetitorScore,
  getCompetitorScoreHistory,
  listAlerts,
  listCompetitors,
  type Alert,
  type Competitor,
} from "../lib/api";
import { getServerAccessToken } from "../lib/supabase-server";
import { SignalScoreCard } from "../components/SignalScoreCard";
import { HomeClient } from "./home-client";

async function latestAlertByCompetitor(
  competitorIds: string[],
  token?: string
): Promise<Map<string, Alert>> {
  if (competitorIds.length === 0) return new Map();
  const { data } = await listAlerts({ competitor_ids: competitorIds, limit: 100 }, token);
  const latest = new Map<string, Alert>();
  for (const alert of data) {
    if (!latest.has(alert.competitor_id)) latest.set(alert.competitor_id, alert);
  }
  return latest;
}

export default async function Page() {
  const token = await getServerAccessToken();
  const competitors = await listCompetitors(token);
  const [scores, histories, latestAlerts] = await Promise.all([
    Promise.all(
      competitors.map((competitor) =>
        getCompetitorScore(competitor.id, token).catch((error) => {
          if (error instanceof ApiError && error.status === 404) return null;
          console.error("Failed to fetch competitor score", { competitorId: competitor.id, error });
          return null;
        })
      )
    ),
    Promise.all(
      competitors.map((competitor) =>
        getCompetitorScoreHistory(competitor.id, 30, token).catch((error) => {
          console.error("Failed to fetch competitor score history", {
            competitorId: competitor.id,
            error,
          });
          return [];
        })
      )
    ),
    latestAlertByCompetitor(
      competitors.map((competitor) => competitor.id),
      token
    ),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-slate-900">Competitors</h1>
      <HomeClient />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {competitors.map((competitor: Competitor, index: number) => {
          const score = scores[index];
          const history = histories[index];
          const lastAlert = latestAlerts.get(competitor.id);
          return (
            <Link key={competitor.id} href={`/radar/${competitor.id}`} className="block">
              {score ? (
                <SignalScoreCard
                  competitorName={competitor.name}
                  score={score.score}
                  delta7d={score.delta_7d}
                  history={history.map((row) => ({ date: row.computed_at, score: row.score }))}
                />
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-slate-600">{competitor.name}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {competitor.discovery_status === "complete" ? "No score yet" : "Discovering…"}
                  </p>
                </div>
              )}
              {lastAlert ? (
                <p className="mt-1 text-xs text-slate-400">
                  Last alert: {new Date(lastAlert.created_at).toLocaleDateString()}
                </p>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
