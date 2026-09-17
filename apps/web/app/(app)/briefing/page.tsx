// Briefing — overnight briefing with KPI tiles, a top movement, and the rest of the signals.
import {
  getCompetitorScore,
  getDashboardSummary,
  listAlerts,
  listCompetitors,
  type DashboardSummary,
} from "@/lib/api";
import { previewBriefingProps } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { BriefingClient } from "../briefing-client";

export default async function BriefingPage() {
  const token = await getOptionalAccessToken();
  if (!token) {
    return <BriefingClient summary={null} {...previewBriefingProps()} />;
  }

  try {
    const [competitors, summary] = await Promise.all([
      listCompetitors(token),
      getDashboardSummary(token).catch(() => null),
    ]);
    const competitorIds = competitors.map((competitor) => competitor.id);

    if (competitorIds.length === 0) {
      return (
        <BriefingClient
          summary={summary}
          highestScore={0}
          highestScoreDelta={0}
          highestScoreCompetitor=""
          movements={[]}
          competitors={[]}
        />
      );
    }

    const [scores, alerts] = await Promise.all([
      Promise.all(
        competitorIds.map((id) => getCompetitorScore(id, token).catch(() => null))
      ),
      listAlerts({ competitor_ids: competitorIds, limit:20 }, token),
    ]);

    const scored = scores
      .map((score, index) => ({ score, competitor: competitors[index] }))
      .filter((item) => item.score !== null);

    const highestItem = scored.reduce<(typeof scored)[number] | null>(
      (best, item) =>
        !best || (item.score!.score > best.score!.score) ? item : best,
      null
    );

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
        summary={summary}
        highestScore={highestItem?.score?.score || 0}
        highestScoreDelta={highestItem?.score?.delta_7d || 0}
        highestScoreCompetitor={highestItem?.competitor?.name || ""}
        movements={recentMovements}
        competitors={competitors}
      />
    );
  } catch {
    return <BriefingClient summary={null} {...previewBriefingProps()} />;
  }
}