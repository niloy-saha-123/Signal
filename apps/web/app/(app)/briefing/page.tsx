// Home — what moved, what Signal expects next, and how each competitor is
// trending. Preview data (previewBriefingProps) is shown ONLY when there is no
// session (the dev-only unauthenticated preview). An authenticated fetch
// failure throws to the (app) error boundary instead of rendering fake data.
import { getCompetitorScore, getDashboardSummary, listAlerts, listCompetitors, listPredictions } from "@/lib/api";
import { previewBriefingProps } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { BriefingClient, type Movement, type Pulse } from "../briefing-client";

export default async function BriefingPage() {
  const token = await getOptionalAccessToken();
  if (!token) {
    return <BriefingClient {...previewBriefingProps()} />;
  }

  const [competitors, summary] = await Promise.all([
    listCompetitors(token),
    getDashboardSummary(token).catch(() => null),
  ]);
  const watched = competitors.filter((competitor) => !competitor.is_own_company);

  if (watched.length === 0) {
    return <BriefingClient summary={summary} movements={[]} pulse={[]} forecasts={[]} competitorCount={0} />;
  }

  const ids = watched.map((competitor) => competitor.id);
  const [scores, alerts, predictions] = await Promise.all([
    Promise.all(ids.map((id) => getCompetitorScore(id, token).catch(() => null))),
    listAlerts({ competitor_ids: ids, limit: 12 }, token),
    listPredictions({ status: "open", limit: 50 }, token).catch(() => null),
  ]);

  const names = new Map(watched.map((competitor) => [competitor.id, competitor.name]));

  const movements: Movement[] = alerts.data.slice(0, 6).map((alert) => ({
    id: alert.id,
    competitorId: alert.competitor_id,
    competitor: names.get(alert.competitor_id) ?? "Unknown competitor",
    pattern: alert.pattern,
    detail: alert.interpretation,
    confidence: alert.confidence,
    timestamp: alert.created_at,
    action: typeof alert.recommended_actions[0]?.action === "string" ? (alert.recommended_actions[0].action as string) : null,
  }));

  const pulse: Pulse[] = watched.map((competitor, index) => ({
    id: competitor.id,
    name: competitor.name,
    score: scores[index]?.score ?? null,
    delta: scores[index]?.delta_7d ?? null,
  }));

  const forecasts = predictions
    ?.slice()
    .sort((a, b) => new Date(a.resolves_at).getTime() - new Date(b.resolves_at).getTime())
    .slice(0, 3)
    .map((prediction) => ({
      id: prediction.id,
      competitor: names.get(prediction.competitor_id) ?? "Unknown competitor",
      statement: prediction.statement,
      probability: prediction.probability,
      resolvesAt: prediction.resolves_at,
    }));

  return (
    <BriefingClient
      summary={summary}
      movements={movements}
      pulse={pulse}
      forecasts={forecasts ?? null}
      competitorCount={watched.length}
    />
  );
}
