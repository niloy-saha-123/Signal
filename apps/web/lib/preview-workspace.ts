import type { Signal } from "@signal/shared";
import type { Alert, Competitor } from "@/lib/api";

export const PREVIEW_NORTHSTAR_ID = "11111111-1111-4111-8111-111111111111";
export const PREVIEW_LUMEN_ID = "22222222-2222-4222-8222-222222222222";

const now = "2026-09-17T12:00:00.000Z";
const earlier = "2026-09-16T09:30:00.000Z";
const oldest = "2026-09-14T15:10:00.000Z";

function competitor(
  id: string,
  name: string,
  domain: string,
): Competitor {
  return {
    id,
    name,
    domain,
    subreddits: [],
    greenhouse_token: null,
    lever_token: null,
    pricing_url: `https://${domain}/pricing`,
    changelog_rss: `https://${domain}/changelog.rss`,
    is_active: true,
    is_own_company: false,
    discovery_status: "complete",
    discovered_at: oldest,
    created_at: oldest,
    updated_at: now,
  };
}

export const PREVIEW_COMPETITORS: Competitor[] = [
  competitor(PREVIEW_NORTHSTAR_ID, "Northstar", "northstar.io"),
  competitor(PREVIEW_LUMEN_ID, "Lumen", "lumenhq.com"),
];

export const PREVIEW_ALERTS: Alert[] = [
  {
    id: "preview-alert-packaging",
    competitor_id: PREVIEW_NORTHSTAR_ID,
    run_id: null,
    pattern: "pricing_packaging_split",
    confidence: 0.86,
    evidence: [],
    interpretation:
      "Related evidence shows Northstar separating self-serve from enterprise plans, with commercial hiring moving in the same direction.",
    vulnerability_window_days: 14,
    recommended_actions: [],
    supporting_cluster_ids: [],
    delivered: true,
    created_at: now,
  },
  {
    id: "preview-alert-hiring",
    competitor_id: PREVIEW_LUMEN_ID,
    run_id: null,
    pattern: "hiring_enterprise_accounts",
    confidence: 0.74,
    evidence: [],
    interpretation:
      "Enterprise account hiring increased in the same window as a quieter packaging change. Watch sales-led releases before treating the shift as complete.",
    vulnerability_window_days: 21,
    recommended_actions: [],
    supporting_cluster_ids: [],
    delivered: true,
    created_at: earlier,
  },
  {
    id: "preview-alert-changelog",
    competitor_id: PREVIEW_NORTHSTAR_ID,
    run_id: null,
    pattern: "product_audit_logs",
    confidence: 0.69,
    evidence: [],
    interpretation:
      "The changelog added audit logs and SSO language in the same release train as the new enterprise SKU.",
    vulnerability_window_days: 10,
    recommended_actions: [],
    supporting_cluster_ids: [],
    delivered: true,
    created_at: oldest,
  },
];

export const PREVIEW_SIGNALS: Signal[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    competitor_id: PREVIEW_NORTHSTAR_ID,
    source: "pricing",
    source_url: "https://northstar.io/pricing",
    title: "Enterprise plan split from self-serve",
    raw_text:
      "Northstar published a dedicated Enterprise SKU with annual contracts, SSO, and audit logs, while the self-serve tiers stayed public.",
    quality_score: 0.91,
    entities: {},
    cluster_id: null,
    collected_at: now,
    created_at: now,
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    competitor_id: PREVIEW_NORTHSTAR_ID,
    source: "changelog",
    source_url: "https://northstar.io/changelog",
    title: "SSO and audit logs in the same release",
    raw_text:
      "The product changelog lists SSO, audit logs, and a new admin role in one train — the same week the packaging page changed.",
    quality_score: 0.84,
    entities: {},
    cluster_id: null,
    collected_at: earlier,
    created_at: earlier,
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    competitor_id: PREVIEW_LUMEN_ID,
    source: "jobs",
    source_url: "https://lumenhq.com/careers",
    title: "Enterprise account hiring up",
    raw_text:
      "Lumen opened three enterprise account-executive roles and a solutions-engineering posting in the same two-week window.",
    quality_score: 0.78,
    entities: {},
    cluster_id: null,
    collected_at: oldest,
    created_at: oldest,
  },
];

export function previewBriefingProps() {
  const names = new Map(PREVIEW_COMPETITORS.map((item) => [item.id, item.name]));
  return {
    highestScore: 82,
    highestScoreDelta: 11,
    highestScoreCompetitor: "Northstar",
    movements: PREVIEW_ALERTS.slice(0, 3).map((alert) => ({
      id: alert.id,
      competitor: names.get(alert.competitor_id) ?? "Unknown",
      title: alert.pattern.replace(/_/g, " "),
      detail: alert.interpretation,
      category: alert.pattern.split("_")[0] ?? "signal",
      timestamp: alert.created_at,
      confidence: alert.confidence,
    })),
    competitors: PREVIEW_COMPETITORS,
  };
}

export function previewDiscoveries() {
  const names = new Map(PREVIEW_COMPETITORS.map((item) => [item.id, item.name]));
  return PREVIEW_ALERTS.map((alert) => ({
    id: alert.id,
    competitor: names.get(alert.competitor_id) ?? "Unknown",
    type: alert.pattern.split("_")[0] ?? "signal",
    title: alert.pattern.replace(/_/g, " "),
    source: "pricing, changelog, jobs",
    detected: new Date(alert.created_at).toLocaleString(),
    snippet: alert.interpretation,
    confidence: alert.confidence,
  }));
}

export function previewBoardCards() {
  return [
    { id: PREVIEW_NORTHSTAR_ID, name: "Northstar", score: 82 },
    { id: PREVIEW_LUMEN_ID, name: "Lumen", score: 61 },
  ];
}

export function previewTrackedEntities() {
  return [
    {
      id: "preview-te-1",
      workspace_id: "33333333-3333-4333-8333-333333333333",
      source: "discovered",
      status: "candidate",
      candidate_name: "Rivalex",
      candidate_domain: "rivalex.com",
      relationship_type: "competitor",
      relationship_confidence: 0.82,
      candidate_reason: "Same ICP, launched a directly competing feature last month.",
      competitor_id: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "preview-te-2",
      workspace_id: "33333333-3333-4333-8333-333333333333",
      source: "user_added",
      status: "confirmed",
      candidate_name: "Northstar",
      candidate_domain: "northstar.io",
      relationship_type: "competitor",
      relationship_confidence: 1,
      candidate_reason: "Tracked since launch.",
      competitor_id: PREVIEW_NORTHSTAR_ID,
      created_at: oldest,
      updated_at: now,
    },
    {
      id: "preview-te-3",
      workspace_id: "33333333-3333-4333-8333-333333333333",
      source: "discovered",
      status: "dismissed",
      candidate_name: "Notion",
      candidate_domain: "notion.so",
      relationship_type: "other",
      relationship_confidence: 0.4,
      candidate_reason: "Adjacent, not a real competitor.",
      competitor_id: null,
      created_at: earlier,
      updated_at: earlier,
    },
  ];
}
