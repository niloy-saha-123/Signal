// Discovery — real tracked-entities triage board (Phase 1's interrupt()-gated HITL flow).
// Confirmed/dismissed via POST /api/discovery/:threadId/resume; new candidates via
// GET /api/tracked-entities; a new discovery sweep via POST /api/discovery/trigger.
import { listCompetitors, listTrackedEntities, type TrackedEntity } from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { previewTrackedEntities } from "@/lib/preview-workspace";
import { DiscoveryBoard, type DiscoveryEntity } from "./discovery-client";

type EntityRow = Omit<TrackedEntity, "created_at" | "updated_at">;

function toDiscoveryEntity(entity: EntityRow, nameById: Map<string, string>): DiscoveryEntity {
  return {
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
  };
}

export default async function DiscoveryPage() {
  const token = await getOptionalAccessToken();
  if (!token) {
    return (
      <DiscoveryBoard
        entities={previewTrackedEntities().map((e) => toDiscoveryEntity(e, new Map()))}
      />
    );
  }

  try {
    const [competitors, entities] = await Promise.all([
      listCompetitors(token),
      listTrackedEntities(token),
    ]);
    const nameById = new Map(competitors.map((c) => [c.id, c.name]));

    const mapped = entities.map((entity) => toDiscoveryEntity(entity, nameById));

    return <DiscoveryBoard entities={mapped} />;
  } catch {
    return <DiscoveryBoard entities={[]} />;
  }
}