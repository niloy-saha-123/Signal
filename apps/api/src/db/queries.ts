// Typed Drizzle query functions used by the API routes and agents.
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { db } from "./client";
import {
  competitorsTable,
  competitorDiscoveryLogTable,
  signalsTable,
  competitorSignalScoresTable,
  agentLatenciesTable,
  companyProfileTable,
} from "./schema";

export type Competitor = typeof competitorsTable.$inferSelect;
export type CompetitorDiscoveryLogEntry = typeof competitorDiscoveryLogTable.$inferSelect;
export type Signal = typeof signalsTable.$inferSelect;
export type SignalScore = typeof competitorSignalScoresTable.$inferSelect;
export type CompanyProfile = typeof companyProfileTable.$inferSelect;
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

// Matches signals_source_check in schema.ts.
type SignalSource = "reddit" | "hn" | "jobs" | "changelog" | "pricing";

export async function createCompetitor(input: {
  name: string;
  domain: string;
}): Promise<Competitor> {
  const [row] = await db
    .insert(competitorsTable)
    .values({ name: input.name, domain: input.domain, discovery_status: "pending" })
    .returning();
  return row;
}

export async function getCompetitorById(id: string): Promise<Competitor | undefined> {
  const [row] = await db.select().from(competitorsTable).where(eq(competitorsTable.id, id));
  return row;
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
