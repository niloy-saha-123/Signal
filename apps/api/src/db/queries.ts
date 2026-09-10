// Typed Drizzle query functions used by the API routes and agents.
import { eq, and, asc, desc, inArray, sql, type SQL } from "drizzle-orm";
import type {
  SignalSource,
  CompetitorDiscoveryResult,
  CompetitorCreateInput,
} from "@signal/shared";
import { db } from "./client";
import {
  competitorsTable,
  competitorDiscoveryLogTable,
  signalsTable,
  signalClustersTable,
  competitorSignalScoresTable,
  agentLatenciesTable,
  agentRunsTable,
  companyProfileTable,
  pricingBaselinesTable,
  pricingDiffsTable,
  alertsTable,
} from "./schema";

export type Competitor = typeof competitorsTable.$inferSelect;
export type CompetitorDiscoveryLogEntry = typeof competitorDiscoveryLogTable.$inferSelect;
export type Signal = typeof signalsTable.$inferSelect;
export type SignalCluster = typeof signalClustersTable.$inferSelect;
export type SignalScore = typeof competitorSignalScoresTable.$inferSelect;
export type PricingBaseline = typeof pricingBaselinesTable.$inferSelect;
export type PricingDiff = typeof pricingDiffsTable.$inferSelect;
export type CompanyProfile = typeof companyProfileTable.$inferSelect;
export type AgentRun = typeof agentRunsTable.$inferSelect;
export type Alert = typeof alertsTable.$inferSelect;
export type CompanyProfileInput = Omit<
  typeof companyProfileTable.$inferInsert,
  "id" | "created_at" | "updated_at"
>;

export type SignalVolumeByDay = {
  day: string;
  count: number;
  weighted_count: number;
};

export type LatencyPercentiles = {
  agent_name: string;
  // duration_ms is nullable (skipped nodes never complete) — if every row in
  // an agent's group is null, PERCENTILE_CONT over an all-null input returns
  // NULL, not 0. `number | null` reflects that instead of type-lying.
  p50: number | null;
  p95: number | null;
};

// Matches competitors_discovery_status_check in schema.ts.
type DiscoveryStatus = "pending" | "in_progress" | "complete" | "failed";


export async function createCompetitor(input: CompetitorCreateInput): Promise<Competitor> {
  const [row] = await db
    .insert(competitorsTable)
    .values({
      name: input.name,
      domain: input.domain,
      ...(input.subreddits === undefined ? {} : { subreddits: input.subreddits }),
      ...(input.greenhouse_token === undefined
        ? {}
        : { greenhouse_token: input.greenhouse_token }),
      ...(input.lever_token === undefined ? {} : { lever_token: input.lever_token }),
      ...(input.pricing_url === undefined ? {} : { pricing_url: input.pricing_url }),
      ...(input.rss_url === undefined ? {} : { changelog_rss: input.rss_url }),
      discovery_status: "pending",
    })
    .returning();
  return row;
}

export async function getCompetitorById(id: string): Promise<Competitor | undefined> {
  const [row] = await db.select().from(competitorsTable).where(eq(competitorsTable.id, id));
  return row;
}

// Chat scope validation and other multi-competitor callers must load in one
// set-based query rather than issuing one SELECT per id.
export async function getCompetitorsByIds(ids: string[]): Promise<Competitor[]> {
  if (ids.length === 0) return [];
  return db.select().from(competitorsTable).where(inArray(competitorsTable.id, ids));
}

export async function listCompetitors(): Promise<Competitor[]> {
  return db.select().from(competitorsTable).orderBy(desc(competitorsTable.created_at));
}

export async function updateDiscoveryStatus(id: string, status: DiscoveryStatus): Promise<void> {
  if (status === "failed") {
    throw new Error(
      "updateDiscoveryStatus does not accept 'failed' — route failures through writeDiscoveryFailure so they're logged"
    );
  }

  await db
    .update(competitorsTable)
    .set({ discovery_status: status, updated_at: new Date() })
    .where(eq(competitorsTable.id, id));
}

export async function getCompetitorDiscoveryLog(
  competitorId: string
): Promise<CompetitorDiscoveryLogEntry[]> {
  return db
    .select()
    .from(competitorDiscoveryLogTable)
    .where(eq(competitorDiscoveryLogTable.competitor_id, competitorId))
    .orderBy(competitorDiscoveryLogTable.discovered_at);
}

// IntentAnalyzer's exact query — competitor + source + a rolling day window,
// backed by signals_competitor_source_created_idx (all 3 columns filtered).
export async function getRecentSignalsByCompetitorAndSource(
  competitorId: string,
  source: SignalSource,
  days = 7
): Promise<Signal[]> {
  return db
    .select()
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.competitor_id, competitorId),
        eq(signalsTable.source, source),
        sql`${signalsTable.created_at} >= NOW() - INTERVAL '1 day' * ${days}`
      )
    );
}

// Retrieval pipeline source — fetch recent signals across multiple competitors
// for BM25 corpus. inArray with empty array is a Drizzle footgun, so short-circuit.
export async function getRecentSignalsByCompetitorIds(
  competitorIds: string[],
  days = 7
): Promise<Signal[]> {
  if (competitorIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(signalsTable)
    .where(
      and(
        inArray(signalsTable.competitor_id, competitorIds),
        sql`${signalsTable.created_at} >= NOW() - INTERVAL '1 day' * ${days}`
      )
    );
}

// Retrieval pipeline hydration — fetch Signal rows by their Pinecone match ids.
// inArray with empty array is a Drizzle footgun, so short-circuit.
export async function getSignalsByIds(ids: string[]): Promise<Signal[]> {
  if (ids.length === 0) {
    return [];
  }

  return db.select().from(signalsTable).where(inArray(signalsTable.id, ids));
}

// PatternDetector Phase 1 — pure SQL volume counts (no LLM per CLAUDE.md).
// DATE_TRUNC/GROUP BY isn't expressible via the fluent builder's typed helpers,
// so this uses `sql` fragments in the select/groupBy/orderBy, per the
// established pattern in .claude/skills/drizzle-orm/SKILL.md.
export async function getSignalVolumeByDay(
  competitorId: string,
  days = 30
): Promise<SignalVolumeByDay[]> {
  return db
    .select({
      // Cast in SQL, not JS: COUNT(*) is bigint (pg driver returns it as a
      // string, not number) and DATE_TRUNC on a timestamptz column comes back
      // as a Date, not a string — ::int/::text make the driver's runtime
      // value match the declared TS type instead of lying about it.
      day: sql<string>`DATE_TRUNC('day', ${signalsTable.created_at})::text`,
      count: sql<number>`COUNT(*)::int`,
      weighted_count: sql<number>`SUM(${signalsTable.quality_score})`,
    })
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.competitor_id, competitorId),
        sql`${signalsTable.created_at} >= NOW() - INTERVAL '1 day' * ${days}`
      )
    )
    .groupBy(sql`DATE_TRUNC('day', ${signalsTable.created_at})`)
    .orderBy(sql`DATE_TRUNC('day', ${signalsTable.created_at})`);
}

// HN collector's watermark — the most recent collected_at for a
// competitor+source, so a run only fetches items newer than the last one it
// already saw. Undefined on a fresh competitor+source pair (no prior run).
export async function getLatestSignalCollectedAt(
  competitorId: string,
  source: SignalSource
): Promise<Date | undefined> {
  const [row] = await db
    .select({ collected_at: signalsTable.collected_at })
    .from(signalsTable)
    .where(and(eq(signalsTable.competitor_id, competitorId), eq(signalsTable.source, source)))
    .orderBy(desc(signalsTable.collected_at))
    .limit(1);
  return row?.collected_at;
}

// PatternDetector's historical-pattern phase — how long this competitor has
// been accumulating signals at all, across every source. Mirrors
// getLatestSignalCollectedAt above but asc (earliest) and no source filter.
export async function getFirstSignalCollectedAt(competitorId: string): Promise<Date | undefined> {
  const [row] = await db
    .select({ collected_at: signalsTable.collected_at })
    .from(signalsTable)
    .where(eq(signalsTable.competitor_id, competitorId))
    .orderBy(asc(signalsTable.collected_at))
    .limit(1);
  return row?.collected_at;
}

// Dedup check collectors run before inserting — real schema has no
// source_id column, so this keys on source_url instead (per CLAUDE.md).
export async function signalExistsBySourceUrl(
  competitorId: string,
  source: SignalSource,
  sourceUrl: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: signalsTable.id })
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.competitor_id, competitorId),
        eq(signalsTable.source, source),
        eq(signalsTable.source_url, sourceUrl)
      )
    )
    .limit(1);
  return row !== undefined;
}

export type CreateSignalInput = {
  competitor_id: string;
  source: SignalSource;
  source_url?: string | null;
  title?: string | null;
  raw_text: string;
};

export async function createSignal(input: CreateSignalInput): Promise<Signal> {
  const [row] = await db.insert(signalsTable).values(input).returning();
  return row;
}

export interface FeedCursor {
  created_at: Date;
  id: string;
}

export interface SignalFeedQuery {
  limit: number;
  competitor_ids?: string[];
  sources?: SignalSource[];
  min_quality?: number;
  created_after?: Date;
  created_before?: Date;
  cursor?: FeedCursor;
}

// Math.floor(NaN) is NaN and NaN survives Math.max/Math.min, so an unparsed
// `?limit=` from the route layer would reach the driver as a NaN LIMIT.
const DEFAULT_FEED_LIMIT = 25;
function feedLimit(value: number): number {
  const floored = Math.floor(value);
  return Number.isFinite(floored) ? Math.max(1, Math.min(100, floored)) : DEFAULT_FEED_LIMIT;
}

// Returns limit + 1 rows so the HTTP boundary can determine whether a next
// cursor exists without a separate COUNT query. The cursor includes both sort
// columns, preventing duplicate/omitted rows when timestamps are equal.
export async function listSignalFeed(input: SignalFeedQuery): Promise<Signal[]> {
  if (input.competitor_ids?.length === 0 || input.sources?.length === 0) return [];

  const predicates: SQL[] = [];
  if (input.competitor_ids) {
    predicates.push(inArray(signalsTable.competitor_id, input.competitor_ids));
  }
  if (input.sources) {
    predicates.push(inArray(signalsTable.source, input.sources));
  }
  if (input.min_quality !== undefined) {
    predicates.push(sql`${signalsTable.quality_score} >= ${input.min_quality}`);
  }
  if (input.created_after) {
    predicates.push(sql`${signalsTable.created_at} >= ${input.created_after}`);
  }
  if (input.created_before) {
    predicates.push(sql`${signalsTable.created_at} <= ${input.created_before}`);
  }
  if (input.cursor) {
    predicates.push(
      sql`(${signalsTable.created_at}, ${signalsTable.id}) < (${input.cursor.created_at}, ${input.cursor.id}::uuid)`
    );
  }

  const limit = feedLimit(input.limit);
  return db
    .select()
    .from(signalsTable)
    .where(and(...predicates))
    .orderBy(desc(signalsTable.created_at), desc(signalsTable.id))
    .limit(limit + 1);
}

export interface AlertFeedQuery {
  limit: number;
  competitor_ids?: string[];
  cursor?: FeedCursor;
}

export async function listAlertFeed(input: AlertFeedQuery): Promise<Alert[]> {
  if (input.competitor_ids?.length === 0) return [];

  const predicates: SQL[] = [];
  if (input.competitor_ids) {
    predicates.push(inArray(alertsTable.competitor_id, input.competitor_ids));
  }
  if (input.cursor) {
    predicates.push(
      sql`(${alertsTable.created_at}, ${alertsTable.id}) < (${input.cursor.created_at}, ${input.cursor.id}::uuid)`
    );
  }

  const limit = feedLimit(input.limit);
  return db
    .select()
    .from(alertsTable)
    .where(and(...predicates))
    .orderBy(desc(alertsTable.created_at), desc(alertsTable.id))
    .limit(limit + 1);
}

export type CreateAlertInput = Omit<
  typeof alertsTable.$inferInsert,
  "id" | "created_at" | "delivered"
>;

export async function createAlert(input: CreateAlertInput): Promise<Alert> {
  const [row] = await db.insert(alertsTable).values(input).returning();
  return row;
}

// Matches pricing_diffs_significance_check in schema.ts.
export type PricingSignificance = "minor" | "moderate" | "critical";

export type CreatePricingBaselineInput = {
  competitor_id: string;
  snapshot: Record<string, unknown>;
};

export async function createPricingBaseline(
  input: CreatePricingBaselineInput
): Promise<PricingBaseline> {
  const [row] = await db.insert(pricingBaselinesTable).values(input).returning();
  return row;
}

// pricing.ts's diff watermark — the most recent baseline captured for a
// competitor before this run's scrape, so the new scrape can diff against
// it. Undefined on a competitor's first-ever pricing scrape.
export async function getLatestPricingBaseline(
  competitorId: string
): Promise<PricingBaseline | undefined> {
  const [row] = await db
    .select()
    .from(pricingBaselinesTable)
    .where(eq(pricingBaselinesTable.competitor_id, competitorId))
    .orderBy(desc(pricingBaselinesTable.captured_at))
    .limit(1);
  return row;
}

export type CreatePricingDiffInput = {
  competitor_id: string;
  baseline_id: string;
  diff: Record<string, unknown>;
  significance: PricingSignificance;
};

export async function createPricingDiff(input: CreatePricingDiffInput): Promise<PricingDiff> {
  const [row] = await db.insert(pricingDiffsTable).values(input).returning();
  return row;
}

// ChangeDetector's exact query — a competitor's pricing diffs within a rolling
// day window, most recent first. Same date-window `sql` fragment shape as
// getRecentSignalsByCompetitorAndSource above.
export async function getRecentPricingDiffs(
  competitorId: string,
  days = 7
): Promise<PricingDiff[]> {
  return db
    .select()
    .from(pricingDiffsTable)
    .where(
      and(
        eq(pricingDiffsTable.competitor_id, competitorId),
        sql`${pricingDiffsTable.detected_at} >= NOW() - INTERVAL '1 day' * ${days}`
      )
    )
    .orderBy(desc(pricingDiffsTable.detected_at));
}

// SynthesisAgent's exact query — latest N scores for one competitor, backed
// by competitor_signal_scores_competitor_computed_idx.
export async function getLatestSignalScores(
  competitorId: string,
  limit = 30
): Promise<SignalScore[]> {
  return db
    .select()
    .from(competitorSignalScoresTable)
    .where(eq(competitorSignalScoresTable.competitor_id, competitorId))
    .orderBy(desc(competitorSignalScoresTable.computed_at))
    .limit(limit);
}

export type CreateSignalScoreInput = {
  competitor_id: string;
  score: number;
  components: Record<string, unknown>;
  delta_7d?: number | null;
  delta_30d?: number | null;
};

// SynthesisAgent's write — one Signal Score row per daily recompute.
export async function createSignalScore(input: CreateSignalScoreInput): Promise<SignalScore> {
  const [row] = await db.insert(competitorSignalScoresTable).values(input).returning();
  return row;
}

// scripts/latency-report.ts's exact query — P50/P95 duration per agent over
// a rolling day window. PERCENTILE_CONT WITHIN GROUP isn't expressible via
// the fluent builder's typed helpers, so this uses `sql` fragments, per the
// established pattern (see getSignalVolumeByDay above).
// No ::int/::text cast needed here: duration_ms is `integer`, and
// PERCENTILE_CONT over an integer/numeric input returns `double precision`
// (float8) — unlike bigint/numeric, pg's default type parser already
// converts float4/float8 to a real JS number, so the raw driver value
// already matches LatencyPercentiles' declared `number | null` type.
export async function getLatencyPercentiles(days = 7): Promise<LatencyPercentiles[]> {
  return db
    .select({
      agent_name: agentLatenciesTable.agent_name,
      p50: sql<number | null>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${agentLatenciesTable.duration_ms})`,
      p95: sql<number | null>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${agentLatenciesTable.duration_ms})`,
    })
    .from(agentLatenciesTable)
    .where(sql`${agentLatenciesTable.created_at} >= NOW() - INTERVAL '1 day' * ${days}`)
    .groupBy(agentLatenciesTable.agent_name);
}

// company_profile is single-row (no natural unique key beyond its own id —
// see schema.ts). `.limit(1)` matches lib/company-context.ts's existing
// direct read of this table. `.orderBy(asc(created_at))` makes a stray
// duplicate row (race in upsertCompanyProfile's select-then-write) resolve
// deterministically to the oldest row instead of flip-flopping between calls.
export async function getCompanyProfile(): Promise<CompanyProfile | null> {
  const [row] = await db
    .select()
    .from(companyProfileTable)
    .orderBy(asc(companyProfileTable.created_at))
    .limit(1);
  return row ?? null;
}

// Select-then-write inside a transaction (same pattern as
// queues/registry.ts's writeDiscoveryFailure): update the existing row if
// one exists, insert otherwise. Not high-concurrency (single-tenant,
// admin-configured), so this is simpler than an ON CONFLICT upsert against
// a fixed known id.
export async function upsertCompanyProfile(input: CompanyProfileInput): Promise<CompanyProfile> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(companyProfileTable).limit(1);

    if (existing) {
      const [row] = await tx
        .update(companyProfileTable)
        .set({ ...input, updated_at: new Date() })
        .where(eq(companyProfileTable.id, existing.id))
        .returning();
      return row;
    }

    const [row] = await tx.insert(companyProfileTable).values(input).returning();
    return row;
  });
}

// ── signal pipeline (Part 7: entity-extractor / quality-scorer / deduplicator) ──
// Collectors (Part 6) only INSERT raw signal rows; these UPDATE the columns each
// pipeline stage populates as a signal moves through it.

export async function getSignalById(id: string): Promise<Signal | undefined> {
  const [row] = await db.select().from(signalsTable).where(eq(signalsTable.id, id));
  return row;
}

export async function updateSignalEntities(
  id: string,
  entities: Record<string, unknown>
): Promise<void> {
  await db.update(signalsTable).set({ entities }).where(eq(signalsTable.id, id));
}

export async function updateSignalQualityScore(id: string, qualityScore: number): Promise<void> {
  await db
    .update(signalsTable)
    .set({ quality_score: qualityScore })
    .where(eq(signalsTable.id, id));
}

export type CreateClusterForSignalPairInput = {
  competitor_id: string;
  canonical_summary: string;
  matched_signal_id: string;
  matched_source: string;
  new_signal_id: string;
  new_source: string;
};

// The whole "first duplicate pair" branch of pipeline/deduplicator.ts as one atomic
// write. Split across createSignalCluster + mergeSignalIntoCluster + two
// updateSignalCluster calls it was non-idempotent: a failure partway through left a
// cluster row with no signals pointing at it, and the BullMQ retry then created a
// second cluster or double-incremented corroboration_count. Queries are inlined
// against `tx` rather than delegating to the single-write helpers above — same
// pattern as upsertCompanyProfile and registry.ts's writeDiscoveryFailure.
export async function createClusterForSignalPair(
  input: CreateClusterForSignalPairInput
): Promise<SignalCluster> {
  return db.transaction(async (tx) => {
    const contributing_sources =
      input.matched_source === input.new_source
        ? [input.matched_source]
        : [input.matched_source, input.new_source];

    const [cluster] = await tx
      .insert(signalClustersTable)
      .values({
        competitor_id: input.competitor_id,
        canonical_summary: input.canonical_summary,
        contributing_sources,
        // Two signals corroborate this cluster the moment it exists — the column
        // defaults to 1, which is only right for a single-signal cluster.
        corroboration_count: 2,
      })
      .returning();

    await tx
      .update(signalsTable)
      .set({ cluster_id: cluster.id })
      .where(inArray(signalsTable.id, [input.matched_signal_id, input.new_signal_id]));

    return cluster;
  });
}

export async function getSignalClusterById(id: string): Promise<SignalCluster | undefined> {
  const [row] = await db
    .select()
    .from(signalClustersTable)
    .where(eq(signalClustersTable.id, id));
  return row;
}

// Select-then-write (same shape as upsertCompanyProfile above) rather than a single
// atomic UPDATE, so the "don't double-append a source already present" rule lives in
// plain JS instead of a SQL CASE expression. Two signals from the same competitor
// landing in pipeline-deduplication concurrently (QUEUE_CONFIG concurrency: 2) can
// race between the select and the write here — flagged for production-reviewer per
// 07-pipeline.md, not addressed in this task.
//
// The cluster bump and the joining signal's cluster_id commit together: split apart, a
// failure between them left corroboration_count already incremented while the signal
// still looked unclustered, so the BullMQ retry incremented it a second time.
export async function mergeSignalIntoCluster(
  clusterId: string,
  signalId: string,
  source: string
): Promise<SignalCluster> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(signalClustersTable)
      .where(eq(signalClustersTable.id, clusterId));

    if (!existing) {
      throw new Error(`mergeSignalIntoCluster: signal cluster ${clusterId} not found`);
    }

    const contributing_sources = existing.contributing_sources.includes(source)
      ? existing.contributing_sources
      : [...existing.contributing_sources, source];

    const [row] = await tx
      .update(signalClustersTable)
      .set({
        contributing_sources,
        corroboration_count: existing.corroboration_count + 1,
        last_updated: new Date(),
      })
      .where(eq(signalClustersTable.id, clusterId))
      .returning();

    await tx
      .update(signalsTable)
      .set({ cluster_id: clusterId })
      .where(eq(signalsTable.id, signalId));

    return row;
  });
}

// ── agent_runs ───────────────────────────────────────────────────────────

export type AgentRunTrigger = "scheduled" | "manual" | "backfill";

export async function createAgentRun(input: {
  competitor_id: string;
  trigger: AgentRunTrigger;
  prompt_version_id?: string | null;
}): Promise<AgentRun> {
  const [row] = await db
    .insert(agentRunsTable)
    .values({
      competitor_id: input.competitor_id,
      trigger: input.trigger,
      ...(input.prompt_version_id === undefined
        ? {}
        : { prompt_version_id: input.prompt_version_id }),
      status: "running",
    })
    .returning();
  return row;
}

// Closes out the analysis-graph DAG's run record — every node that reaches
// SynthesisAgent (or fails before it) finishes here, per agent_runs_status_check
// / agent_runs_outcome_check in schema.ts.
export async function completeAgentRun(
  runId: string,
  status: "completed" | "failed",
  outcome?: "alert" | "digest" | "suppress"
): Promise<void> {
  await db
    .update(agentRunsTable)
    .set({ status, outcome, completed_at: new Date() })
    .where(eq(agentRunsTable.id, runId));
}

// ── competitor discovery write-back (Part 11) ────────────────────────────

// CompetitorDiscoveryAgent's write-back — the discovery BullMQ worker calls
// this once discovery finishes: it stamps the five discovered field values
// (+ discovery_status + discovered_at) onto the competitors row and bulk-inserts
// one competitor_discovery_log row per attempted field, all in one transaction.
// The caller merges any skipped field's prior value into `result` first, so
// writing all five back unconditionally is a no-op for those.
//
// This deliberately writes discovery_status = 'failed' WITHOUT going through
// updateDiscoveryStatus's guard (which throws on 'failed'), because it writes
// the diagnostic competitor_discovery_log rows in the SAME transaction — the
// same legitimate-exception rationale as queues/registry.ts's writeDiscoveryFailure.
export async function finalizeDiscovery(
  competitorId: string,
  result: CompetitorDiscoveryResult
): Promise<void> {
  // `failed` is terminal (no auto-rediscovery), so only use it when the agent
  // actually probed and came back with nothing usable. A competitor created
  // with every field pre-filled produces `logs: []` — that row is fully usable,
  // not a failure. And a run where every probe missed but a pre-filled value
  // survived is still usable.
  const anyValue =
    result.subreddits.length > 0 ||
    result.greenhouse_token != null ||
    result.lever_token != null ||
    result.pricing_url != null ||
    result.changelog_rss != null;
  const discoveryStatus = result.logs.length === 0 || anyValue ? "complete" : "failed";

  await db.transaction(async (tx) => {
    await tx
      .update(competitorsTable)
      .set({
        subreddits: result.subreddits,
        greenhouse_token: result.greenhouse_token,
        lever_token: result.lever_token,
        pricing_url: result.pricing_url,
        changelog_rss: result.changelog_rss,
        discovery_status: discoveryStatus,
        discovered_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(competitorsTable.id, competitorId));

    // Drizzle's .values([]) throws — skip the insert when nothing was attempted.
    if (result.logs.length > 0) {
      await tx.insert(competitorDiscoveryLogTable).values(
        result.logs.map((l) => ({
          competitor_id: competitorId,
          field_name: l.field_name,
          attempted_urls: l.attempted_urls,
          discovered_value: l.discovered_value,
          status: l.status,
          error_message: l.error_message,
        }))
      );
    }
  });
}
