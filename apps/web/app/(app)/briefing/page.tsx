// Briefing — Overnight briefing with top movements, signal scores, and insights
import { getCompetitorScore, listAlerts, listCompetitors } from "@/lib/api";
import { previewBriefingProps } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { BriefingClient } from "../briefing-client";

export default async function BriefingPage() {
  const token = await getOptionalAccessToken();
  if (!token) {
    return <BriefingClient {...previewBriefingProps()} />;
  }

  try {
    const competitors = await listCompetitors(token);
    const competitorIds = competitors.map((competitor) => competitor.id);

    if (competitorIds.length === 0) {
      return (
        <BriefingClient
          highestScore={0}
          highestScoreDelta={0}
          highestScoreCompetitor=""
          movements={[]}
          competitors={[]}
        />
      );
    }

    const [scores, alerts] = await Promise.all([
      Promise.all(competitorIds.map((id) => getCompetitorScore(id, token).catch(() => null))),
      listAlerts({ competitor_ids: competitorIds, limit: 20 }, token),
    ]);

    const scoresWithCompetitor = scores
      .map((score, index) => ({ score, competitor: competitors[index] }))
      .filter((item) => item.score !== null);

    const highestItem = scoresWithCompetitor.sort(
      (a, b) => (b.score?.score || 0) - (a.score?.score || 0),
    )[0];

    const recentMovements = alerts.data.slice(0, 10).map((alert) => {
      const competitor = competitors.find((item) => item.id === alert.competitor_id);
      return {
        id: alert.id,
        competitor: competitor?.name || "Unknown",
        title: alert.pattern,
        detail: alert.interpretation || "",
        category: alert.pattern.split("_")[0] || "signal",
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
  } catch {
    return <BriefingClient {...previewBriefingProps()} />;
  }
}
