// Competitor profile: one payload for the profile page, plus the pure shapers the per-piece
// /:id/score, /scores and /trend handlers share with it.
import { SignalScoreComponentsSchema, type Signal, type SignalSource } from "@signal/shared";
import type * as queries from "../db/queries";
import type { Competitor } from "../db/queries";
import { logger } from "../lib/logger";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// competitor_signal_scores.components is jsonb with no DB-level shape enforcement
// (db/schema.ts) — the SignalScore/components TS type is a compile-time promise, not a
// runtime guarantee. Every route returning it validates with SignalScoreComponentsSchema and
// degrades to this rather than trusting the column or crashing the request.
const DEFAULT_SCORE_COMPONENTS = {
  mention_velocity: 0,
  sentiment_trajectory: 0,
  hiring_momentum: 0,
  pricing_change_recency: 0,
  vulnerability_window_status: "none" as const,
};

type ScoreRow = Awaited<ReturnType<typeof queries.getLatestSignalScores>>[number];

// ponytail: keyword-based job-title classifier — a heuristic, not ground truth. First
// regex to match wins, so order encodes priority for titles that could plausibly span two
// departments ("Sales Engineer" -> Sales, not Engineering; "Product Marketing Manager" ->
// Marketing, not Product). Upgrade path: capture a real `department` field from
// Greenhouse/Lever's API in the jobs collector once this needs to be more precise than
// "roughly right."
const DEPARTMENT_KEYWORDS: [string, RegExp][] = [
  [
    "Data",
    /\b(data scientist|data engineer|data analyst|analytics|machine learning|ml engineer)\b/i,
  ],
  ["Sales", /\b(sales|account executive|\bsdr\b|\bbdr\b|business development)\b/i],
  ["Marketing", /\b(marketing|growth|\bseo\b|brand|content strategist)\b/i],
  [
    "Customer Success/Support",
    /\b(customer success|customer support|support engineer|technical support|help desk)\b/i,
  ],
  ["Product", /\b(product manager|product owner|product lead|product analyst)\b/i],
  ["Design", /\b(designer|design|\bux\b|ui\/ux|user experience)\b/i],
  ["Engineering", /\b(engineer|engineering|developer|\bswe\b|software)\b/i],
  [
    "People/HR",
    /\b(people ops|people operations|human resources|recruiter|recruiting|talent acquisition|\bhr\b)\b/i,
  ],
  ["Operations", /\b(operations|logistics|supply chain|facilities)\b/i],
  ["Finance", /\b(finance|accounting|controller|treasury|fp&a)\b/i],
];

function classifyDepartment(title: string | null): string {
  const text = title ?? "";
  for (const [department, pattern] of DEPARTMENT_KEYWORDS) {
    if (pattern.test(text)) return department;
  }
  return "Other";
}

// Recent-vs-prior split mirrors synthesis.ts's computeMentionVelocity, adapted to an
// arbitrary caller-supplied `days` instead of the hardcoded 7/14: the window's first half
// is "recent", the second half is "prior". Departments whose delta is 0 are dropped so the
// chart isn't a wall of zero-bars; ties in delta preserve first-seen order (stable sort).
export function computeHiringDeltas(
  jobSignals: { title: string | null; created_at: Date }[],
  days: number,
  now: number
): { department: string; delta: number }[] {
  const half = days / 2;
  const recentCounts = new Map<string, number>();
  const priorCounts = new Map<string, number>();
  for (const signal of jobSignals) {
    const ageDays = (now - signal.created_at.getTime()) / MS_PER_DAY;
    const bucket = ageDays < half ? recentCounts : priorCounts;
    const department = classifyDepartment(signal.title);
    bucket.set(department, (bucket.get(department) ?? 0) + 1);
  }
  const departments = new Set([...recentCounts.keys(), ...priorCounts.keys()]);
  return [...departments]
    .map((department) => ({
      department,
      delta: (recentCounts.get(department) ?? 0) - (priorCounts.get(department) ?? 0),
    }))
    .filter((row) => row.delta !== 0)
    .sort((a, b) => b.delta - a.delta);
}

export function scoreSummary(rows: ScoreRow[]) {
  const latest = rows[0];
  if (!latest) return null;
  const parsedComponents = SignalScoreComponentsSchema.safeParse(latest.components);
  if (!parsedComponents.success) {
    logger.warn("Signal score row has malformed components — returning zeroed defaults", {
      competitor_id: latest.competitor_id,
      score_id: latest.id,
    });
  }
  return {
    score: latest.score,
    components: parsedComponents.success ? parsedComponents.data : DEFAULT_SCORE_COMPONENTS,
    computed_at: latest.computed_at,
    delta_7d: latest.delta_7d ?? null,
    delta_30d: latest.delta_30d ?? null,
  };
}

// Newest-first rows in — reverse to chronological order, the shape every sparkline/trend
// chart on the frontend expects.
export function scoreHistory(rows: ScoreRow[], competitorId: string) {
  return [...rows].reverse().map((row) => {
    const parsedComponents = SignalScoreComponentsSchema.safeParse(row.components);
    if (!parsedComponents.success) {
      logger.warn("Signal score row has malformed components — returning zeroed defaults", {
        competitor_id: competitorId,
        score_id: row.id,
      });
    }
    return {
      id: row.id,
      competitor_id: row.competitor_id,
      score: row.score,
      components: parsedComponents.success ? parsedComponents.data : DEFAULT_SCORE_COMPONENTS,
      delta_7d: row.delta_7d ?? null,
      delta_30d: row.delta_30d ?? null,
      computed_at: row.computed_at.toISOString(),
    };
  });
}

// getSignalVolumeByDay's `day` is already a plain UTC "YYYY-MM-DD" string (a Postgres
// ::date cast, not ::text) — no Date round-trip needed or wanted here, that's exactly
// the timezone-ambiguous parsing this join used to be exposed to.
export function trendSeries(
  rows: ScoreRow[],
  volumeByDay: { day: string; count: number }[],
  competitorId: string
) {
  const volumeByDate = new Map(volumeByDay.map((row) => [row.day, row.count]));
  return [...rows].reverse().map((row) => {
    const date = row.computed_at.toISOString().slice(0, 10);
    const parsedComponents = SignalScoreComponentsSchema.safeParse(row.components);
    if (!parsedComponents.success) {
      logger.warn("Signal score row has malformed components — defaulting sentiment to 0", {
        competitor_id: competitorId,
        score_id: row.id,
      });
    }
    return {
      date,
      mention_volume: volumeByDate.get(date) ?? 0,
      sentiment: parsedComponents.success ? parsedComponents.data.sentiment_trajectory : 0,
      score: row.score,
    };
  });
}

export type CoverageState = "Reporting" | "Watching" | "Looking" | "Not found";

const CONFIGURED: Array<[SignalSource, (c: Competitor) => boolean]> = [
  ["website", (c) => c.website_urls.length > 0],
  ["pricing", (c) => Boolean(c.pricing_url)],
  ["changelog", (c) => Boolean(c.changelog_rss)],
  ["jobs", (c) => Boolean(c.greenhouse_token || c.lever_token)],
  ["reddit", (c) => c.subreddits.length > 0],
  ["hn", () => true],
  ["github", (c) => Boolean(c.github_org)],
  ["community", (c) => Boolean(c.discourse_url || c.forum_feeds.length || c.stackoverflow_tag)],
  ["postings", (c) => Boolean(c.postings_rss)],
  ["news", (c) => !c.is_own_company || Boolean(c.news_query)],
  ["docs", (c) => Boolean(c.docs_sitemap_url)],
  ["packages", (c) => c.npm_packages.length > 0 || c.pypi_packages.length > 0],
  ["blog", (c) => c.blog_feeds.length > 0],
  ["social", (c) => c.social_feeds.length > 0 || Boolean(c.bluesky_handle)],
];

export function coverageFor(
  competitor: Competitor,
  signals: Pick<Signal, "source">[]
): Array<{ source: SignalSource; state: CoverageState }> {
  const reporting = new Set<SignalSource>(signals.map((s) => s.source));
  const settled = competitor.discovery_status === "complete" || competitor.discovery_status === "failed";
  const rows = CONFIGURED.map(([source, isConfigured]) => ({
    source,
    state: (reporting.has(source)
      ? "Reporting"
      : isConfigured(competitor)
        ? "Watching"
        : settled
          ? "Not found"
          : "Looking") as CoverageState,
  }));
  const listed = new Set(rows.map((r) => r.source));
  for (const source of reporting) if (!listed.has(source)) rows.push({ source, state: "Reporting" });
  return rows;
}

export interface CompetitorProfile {
  competitor: Competitor;
  score: ReturnType<typeof scoreSummary>;
  history: { date: string; score: number }[];
  trend: ReturnType<typeof trendSeries>;
  hiring: ReturnType<typeof computeHiringDeltas>;
  forecasts: Awaited<ReturnType<typeof queries.listPredictionsForWorkspace>>;
  signals: Awaited<ReturnType<typeof queries.listSignalFeed>>;
  coverage: ReturnType<typeof coverageFor>;
}

export interface CompetitorProfileDeps {
  getCompetitorByIdForWorkspace: typeof queries.getCompetitorByIdForWorkspace;
  getLatestSignalScores: typeof queries.getLatestSignalScores;
  getSignalVolumeByDay: typeof queries.getSignalVolumeByDay;
  getJobSignalsForHiringDelta: typeof queries.getJobSignalsForHiringDelta;
  listPredictionsForWorkspace: typeof queries.listPredictionsForWorkspace;
  listSignalFeed: typeof queries.listSignalFeed;
}

async function settle<T>(
  promise: Promise<T>,
  fallback: T,
  label: string,
  competitorId: string
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    logger.warn(`competitor profile: ${label} failed`, { competitor_id: competitorId, error });
    return fallback;
  }
}

export async function loadCompetitorProfile(
  workspaceId: string,
  competitorId: string,
  deps: CompetitorProfileDeps,
  now: number = Date.now()
): Promise<CompetitorProfile | null> {
  const competitor = await deps.getCompetitorByIdForWorkspace(competitorId, workspaceId);
  if (!competitor) return null;

  const [scores, volume, jobs, forecasts, signals] = await Promise.all([
    settle(deps.getLatestSignalScores(competitorId, 90), [], "scores", competitorId),
    settle(deps.getSignalVolumeByDay(competitorId, 30), [], "volume", competitorId),
    settle(deps.getJobSignalsForHiringDelta(competitorId, 30), [], "hiring", competitorId),
    settle(
      deps.listPredictionsForWorkspace({
        workspace_id: workspaceId,
        competitor_id: competitorId,
        status: "open",
        limit: 20,
      }),
      [],
      "forecasts",
      competitorId
    ),
    settle(
      deps.listSignalFeed({
        workspace_id: workspaceId,
        competitor_ids: [competitorId],
        created_after: new Date(now - 30 * MS_PER_DAY),
        limit: 50,
      }),
      [],
      "signals",
      competitorId
    ),
  ]);

  return {
    competitor,
    score: scoreSummary(scores),
    history: scoreHistory(scores, competitorId).map((r) => ({ date: r.computed_at, score: r.score })),
    trend: trendSeries(scores.slice(0, 30), volume, competitorId),
    hiring: computeHiringDeltas(jobs, 30, now),
    forecasts: [...forecasts].sort((a, b) => a.resolves_at.getTime() - b.resolves_at.getTime()),
    signals,
    coverage: coverageFor(competitor, signals),
  };
}
