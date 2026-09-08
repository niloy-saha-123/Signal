// Typed Drizzle query functions used by the API routes and agents.
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "./client";
import { competitorsTable, competitorDiscoveryLogTable, signalsTable } from "./schema";

export type Competitor = typeof competitorsTable.$inferSelect;
export type CompetitorDiscoveryLogEntry = typeof competitorDiscoveryLogTable.$inferSelect;
export type Signal = typeof signalsTable.$inferSelect;

export type SignalVolumeByDay = {
  day: string;
  count: number;
  weighted_count: number;
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
