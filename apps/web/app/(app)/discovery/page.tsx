import { listAlerts, listCompetitors } from "@/lib/api";
import { previewDiscoveries } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { DiscoveryClient } from "./discovery-client";

export default async function DiscoveryPage() {
  const token = await getOptionalAccessToken();
  if (!token) {
    return <DiscoveryClient discoveries={previewDiscoveries()} />;
  }

  try {
    const competitors = await listCompetitors(token);
    const competitorIds = competitors.map((competitor) => competitor.id);
    const alerts =
      competitorIds.length > 0
        ? await listAlerts({ competitor_ids: competitorIds, limit: 20 }, token)
        : { data: [] };

    const discoveries = alerts.data.map((alert) => {
      const competitor = competitors.find((item) => item.id === alert.competitor_id);
      return {
        id: alert.id,
        competitor: competitor?.name || "Unknown",
        type: alert.pattern.split("_")[0] || "signal",
        title: alert.pattern.replace(/_/g, " "),
        source: "collected evidence",
        detected: new Date(alert.created_at).toLocaleString(),
        snippet: alert.interpretation,
        confidence: alert.confidence,
      };
    });

    return <DiscoveryClient discoveries={discoveries} />;
  } catch {
    return <DiscoveryClient discoveries={previewDiscoveries()} />;
  }
}
