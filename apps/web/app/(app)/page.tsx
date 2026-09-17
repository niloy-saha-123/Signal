// apps/web/app/page.tsx
// Briefing — Overnight briefing with top movements, signal scores, and insights
import { getServerAccessToken } from "@/lib/supabase-server";
import { listCompetitors, getCompetitorScore, listAlerts } from "@/lib/api";
import { BriefingClient } from "./briefing-client";

export default async function BriefingPage() {
  const token = await getServerAccessToken();
  
  // Fetch competitors and their data in parallel
  const competitors = await listCompetitors(token);
  const competitorIds = competitors.map((c) => c.id);
  
  const [scores, alerts] = await Promise.all([
    Promise.all(
      competitorIds.map((id) =>
        getCompetitorScore(id, token).catch(() => null)
      )
    ),
    listAlerts({ competitor_ids: competitorIds, limit: 20 }, token),
  ]);

  // Find the highest signal score and map it to competitor
  const scoresWithCompetitor = scores
    .map((score, index) => ({ score, competitor: competitors[index] }))
    .filter((item) => item.score !== null);
  
  const highestItem = scoresWithCompetitor.sort(
    (a, b) => (b.score?.score || 0) - (a.score?.score || 0)
  )[0];

  // Get recent movements from alerts
  const recentMovements = alerts.data.slice(0, 10).map((alert) => {
    const competitor = competitors.find((c) => c.id === alert.competitor_id);
    return {
      id: alert.id,
      competitor: competitor?.name || "Unknown",
      title: alert.pattern,
      detail: alert.interpretation || "",
      category: alert.pattern.split("_")[0] || "signal", // Extract category from pattern
      timestamp: alert.created_at,
      confidence: alert.confidence,
    };
  });

  return (
    <BriefingClient
      highestScore={highestItem?.score?.score || 0}
      highestScoreDelta={highestItem?.score?.delta_7d || 0}
      highestScoreCompetitor={highestItem?.competitor?.name || ""}
      movements={recentMovements}
      competitors={competitors}
    />
  );
}
