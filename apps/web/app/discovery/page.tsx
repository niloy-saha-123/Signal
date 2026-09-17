// apps/web/app/discovery/page.tsx
// Discovery — New competitive movements to review (track or dismiss)
import { getServerAccessToken } from "../../lib/supabase-server";
import { listAlerts, listCompetitors } from "../../lib/api";
import { DiscoveryClient } from "./discovery-client";

export default async function DiscoveryPage() {
  const token = await getServerAccessToken();
  
  const competitors = await listCompetitors(token);
  const competitorIds = competitors.map((c) => c.id);
  
  // Get recent alerts to review
  const alerts = await listAlerts(
    { competitor_ids: competitorIds, limit: 20 },
    token
  );

  // Map alerts to discovery items
  const discoveries = alerts.data.map((alert) => {
    const competitor = competitors.find((c) => c.id === alert.competitor_id);
    return {
      id: alert.id,
      competitor: competitor?.name || "Unknown",
      type: alert.pattern.split("_")[0] || "signal",
      title: alert.pattern.replace(/_/g, " "),
      source: "competitive intelligence", // Could extract from evidence
      detected: new Date(alert.created_at).toLocaleString(),
      snippet: alert.interpretation,
      confidence: alert.confidence,
    };
  });

  return <DiscoveryClient discoveries={discoveries} />;
}
