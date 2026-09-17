// Discovery — real tracked-entities triage board (Phase 1's interrupt()-gated HITL flow).
// Confirmed/dismissed via POST /api/discovery/:threadId/resume; new candidates via
// GET /api/tracked-entities; a new discovery sweep via POST /api/discovery/trigger.
import { listCompetitors, listTrackedEntities } from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { previewTrackedEntities } from "@/lib/preview-workspace";
import { DiscoveryBoard, type DiscoveryEntity } from "./discovery-client";

export default async function DiscoveryPage() {
  const token = await getOptionalAccessToken();
  if (!token) {
    return <DiscoveryBoard entities={previewTrackedEntities() as unknown as DiscoveryEntity[]} />;
  }

  try {
    const [competitors, entities] = await Promise.all([
      listCompetitors(token),
      listTrackedEntities(token),
    ]);
    const nameById = new Map(competitors.map((c) => [c.id, c.name]));

    const mapped: DiscoveryEntity[] = entities.map((entity) => ({
      id: entity.id,
      workspaceId: entity.workspace_id,
      name:
        (entity.competitor_id && nameById.get(entity.competitor_id)) ||
        entity.candidate_name ||
        entity.candidate_domain ||
        "Unknown",
      domain: entity.candidate_domain ?? "",
      relationshipType: entity.relationship_type ?? "competitor",
      source: entity.source,
      confidence: entity.relationship_confidence,
      reason: entity.candidate_reason,
      status: entity.status,
    }));

    return <DiscoveryBoard entities={mapped} />;
  } catch {
    return <DiscoveryBoard entities={[]} />;
  }
}