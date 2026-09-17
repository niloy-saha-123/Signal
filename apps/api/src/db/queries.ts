// Typed Drizzle query functions used by the API routes and agents.
import { eq, and, asc, desc, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type {
  AgentName,
  SignalSource,
  CompetitorDiscoveryResult,
  CompetitorCreateInput,
  RagEvalResult,
  RagEvalRunSummary,
  RagEvalCategory,
  RagEvalConfidenceLevel,
} from "@signal/shared";
import {
  RagEvalResultSchema,
  RagEvalRunSummarySchema,
  RagEvalCategorySchema,
  RagEvalConfidenceLevelSchema,
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
  companyDocumentsTable,
  pricingBaselinesTable,
  pricingDiffsTable,
  alertsTable,
  llmCostsTable,
  signalPipelineOutboxTable,
  promptVersionsTable,
  agentTestCasesTable,
  ragEvalDatasetTable,
  ragEvalRunsTable,
  trackedEntitiesTable,
  workspacesTable,
  workspaceMembersTable,
  chatThreadsTable,
  type SignalPipelineStage,
} from "./schema";
import {
  AgentTestCaseSchema,
  PromotePromptVersionInputSchema,
  PromptVersionCandidateSchema,
  passesPromotionGate,
  twoProportionZTest,
  type AgentTestCase,
  type PromotePromptVersionInput,
  type PromptVersionCandidate,
  type PromotionResult,
} from "../evaluation/prompt-contracts";

export type Competitor = typeof competitorsTable.$inferSelect;
export type CompetitorDiscoveryLogEntry = typeof competitorDiscoveryLogTable.$inferSelect;
export type Signal = typeof signalsTable.$inferSelect;
export type SignalPipelineOutbox = typeof signalPipelineOutboxTable.$inferSelect;
export type SignalCluster = typeof signalClustersTable.$inferSelect;
export type SignalScore = typeof competitorSignalScoresTable.$inferSelect;
export type PricingBaseline = typeof pricingBaselinesTable.$inferSelect;
export type PricingDiff = typeof pricingDiffsTable.$inferSelect;
export type CompanyProfile = typeof companyProfileTable.$inferSelect;
export type CompanyDocument = typeof companyDocumentsTable.$inferSelect;
export type AgentRun = typeof agentRunsTable.$inferSelect;
export type AgentLatency = typeof agentLatenciesTable.$inferSelect;
export type LlmCost = typeof llmCostsTable.$inferSelect;
export type Alert = typeof alertsTable.$inferSelect;
export type Workspace = typeof workspacesTable.$inferSelect;
export type WorkspaceMember = typeof workspaceMembersTable.$inferSelect;
export type ChatThread = typeof chatThreadsTable.$inferSelect;
export type CompanyProfileInput = Omit<
  typeof companyProfileTable.$inferInsert,
  "id" | "created_at" | "updated_at"
>;

export type RagEvalSeedCaseInput = {
  id: string;
  competitor_id: string;
  category: RagEvalCategory;
  question: string;
  expected_answer: string;
  supporting_signal_ids: string[];
  confidence_level: RagEvalConfidenceLevel;
};

export type RagEvalSeedResult = { inserted: number; unchanged: number };

export class RagEvalSeedConflictError extends Error {
  readonly conflictingIds: string[];

  constructor(conflictingIds: readonly string[]) {
    const sorted = [...conflictingIds].sort();
    super(`RAG eval seed conflicts: ${sorted.join(", ")}`);
    this.name = "RagEvalSeedConflictError";
    this.conflictingIds = sorted;
  }
}

export class RagEvalSeedReferenceError extends Error {
  readonly caseIds: string[];

  constructor(caseIds: readonly string[]) {
    const sorted = [...caseIds].sort();
    super(`RAG eval seed references are invalid for cases: ${sorted.join(", ")}`);
    this.name = "RagEvalSeedReferenceError";
    this.caseIds = sorted;
  }
}

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

export type AgentLatencyReportRow = {
  agent_name: string;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  mean: number | null;
  sample_count: number;
  failed_count: number;
  // Historical output name: this counts completed telemetry spans, whether
  // attributed to an agent run or a queue job.
  run_count: number;
};

export type CostByCompetitorDayRow = {
  competitor_id: string | null;
  day: string;
  cost_usd: number;
};

// Matches competitors_discovery_status_check in schema.ts.
type DiscoveryStatus = "pending" | "in_progress" | "complete" | "failed";

// ── prompt evaluation and promotion ─────────────────────────────────────

export async function getPromptVersion(
  agentName: AgentName,
  version: number
): Promise<PromptVersionCandidate | undefined> {
  const [row] = await db
    .select()
    .from(promptVersionsTable)
    .where(
      and(
        eq(promptVersionsTable.agent_name, agentName),
        eq(promptVersionsTable.version, version)
      )
    )
    .limit(1);
  return row === undefined ? undefined : PromptVersionCandidateSchema.parse(row);
}

export async function listAgentTestCases(agentName: AgentName): Promise<AgentTestCase[]> {
  const rows = await db
    .select()
    .from(agentTestCasesTable)
    .where(eq(agentTestCasesTable.agent_name, agentName))
    .orderBy(asc(agentTestCasesTable.created_at), asc(agentTestCasesTable.id));
  return rows.map((row) => AgentTestCaseSchema.parse(row));
}

export async function promotePromptVersion(
  input: PromotePromptVersionInput
): Promise<PromotionResult> {
  const parsedInput = PromotePromptVersionInputSchema.parse(input);

  return db.transaction(async (tx) => {
    // Lock the complete per-agent version set in one deterministic order. This
    // serializes concurrent promotions for the same agent before either request
    // reads the active row or evaluates its gate, and avoids the non-deferrable
    // one-active partial-index race.
    const lockedResult = await tx.execute(sql`
      SELECT
        ${promptVersionsTable.id} AS id,
        ${promptVersionsTable.agent_name} AS agent_name,
        ${promptVersionsTable.version} AS version,
        ${promptVersionsTable.prompt_text} AS prompt_text,
        ${promptVersionsTable.is_active} AS is_active,
        ${promptVersionsTable.accuracy} AS accuracy,
        ${promptVersionsTable.promoted_at} AS promoted_at,
        ${promptVersionsTable.created_at} AS created_at
      FROM ${promptVersionsTable}
      WHERE ${promptVersionsTable.agent_name} = ${parsedInput.agentName}
      ORDER BY ${promptVersionsTable.version} ASC, ${promptVersionsTable.id} ASC
      FOR UPDATE
    `);
    const lockedPrompts = lockedResult.rows.map((row) =>
      PromptVersionCandidateSchema.parse(row)
    );
    const candidate = lockedPrompts.find(
      (prompt) => prompt.version === parsedInput.candidateVersion
    );
    if (!candidate) {
      throw new Error(
        `Prompt candidate ${parsedInput.agentName} version ${parsedInput.candidateVersion} not found`
      );
    }
    if (candidate.is_active) {
      throw new Error("Prompt candidate is already active");
    }

    const activePrompts = lockedPrompts.filter((prompt) => prompt.is_active);
    if (activePrompts.length !== 1) {
      throw new Error(
        `Prompt-version invariant violated for ${parsedInput.agentName}: expected exactly one active version`
      );
    }
    const active = activePrompts[0];
    if (active.version !== parsedInput.activeVersion) {
      throw new Error(
        `Active prompt version changed since evaluation: expected ${parsedInput.activeVersion}, found ${active.version}`
      );
    }

    const statistics = twoProportionZTest(
      parsedInput.candidate.passed,
      parsedInput.candidate.total,
      parsedInput.active.passed,
      parsedInput.active.total
    );
    const baseResult = {
      agent_name: parsedInput.agentName,
      candidate_version: candidate.version,
      active_version: active.version,
      candidate_counts: parsedInput.candidate,
      active_counts: parsedInput.active,
      statistics,
    };

    if (!passesPromotionGate(statistics)) {
      return {
        ...baseResult,
        promoted: false,
        reason:
          statistics.candidate_accuracy <= statistics.active_accuracy
            ? "not-better"
            : "not-significant",
      };
    }

    const [deactivated] = await tx
      .update(promptVersionsTable)
      .set({ is_active: false })
      .where(
        and(
          eq(promptVersionsTable.id, active.id),
          eq(promptVersionsTable.agent_name, parsedInput.agentName),
          eq(promptVersionsTable.is_active, true)
        )
      )
      .returning({ id: promptVersionsTable.id });
    if (!deactivated) {
      throw new Error("Active prompt changed while promotion locks were held");
    }

    const promotedAt = new Date();
    const [activated] = await tx
      .update(promptVersionsTable)
      .set({
        is_active: true,
        accuracy: statistics.candidate_accuracy,
        promoted_at: promotedAt,
      })
      .where(
        and(
          eq(promptVersionsTable.id, candidate.id),
          eq(promptVersionsTable.agent_name, parsedInput.agentName),
          eq(promptVersionsTable.version, parsedInput.candidateVersion),
          eq(promptVersionsTable.is_active, false)
        )
      )
      .returning({ id: promptVersionsTable.id });
    if (!activated) {
      throw new Error("Prompt candidate changed while promotion locks were held");
    }

    return { ...baseResult, promoted: true, reason: "promoted" };
  });
}

function sameStringArray(left: readonly string[] | null, right: readonly string[]): boolean {
  return left !== null && left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function seedRagEvalDataset(
  cases: readonly RagEvalSeedCaseInput[]
): Promise<RagEvalSeedResult> {
  return db.transaction(async (tx) => {
    const competitorIds = [...new Set(cases.map((seedCase) => seedCase.competitor_id))].sort();
    const signalIds = [...new Set(cases.flatMap((seedCase) => seedCase.supporting_signal_ids))].sort();
    const [competitorResult, signalResult] = await Promise.all([
      tx.execute(sql`
        SELECT ${competitorsTable.id} AS id
        FROM ${competitorsTable}
        WHERE ${competitorsTable.id} = ANY(${sql.param(competitorIds)}::uuid[])
        ORDER BY ${competitorsTable.id} ASC
        FOR KEY SHARE
      `),
      tx.execute(sql`
        SELECT ${signalsTable.id} AS id, ${signalsTable.competitor_id} AS competitor_id
        FROM ${signalsTable}
        WHERE ${signalsTable.id} = ANY(${sql.param(signalIds)}::uuid[])
        ORDER BY ${signalsTable.id} ASC
        FOR KEY SHARE
      `),
    ]);
    const foundCompetitorIds = new Set(competitorResult.rows.map((row) => String(row.id)));
    const signalCompetitorIds = new Map(
      signalResult.rows.map((row) => [String(row.id), String(row.competitor_id)])
    );
    const invalidReferenceCaseIds = cases.flatMap((seedCase) =>
      !foundCompetitorIds.has(seedCase.competitor_id) ||
      seedCase.supporting_signal_ids.some(
        (signalId) => signalCompetitorIds.get(signalId) !== seedCase.competitor_id
      )
        ? [seedCase.id]
        : []
    );
    if (invalidReferenceCaseIds.length > 0) throw new RagEvalSeedReferenceError(invalidReferenceCaseIds);

    const insertRows = cases
      .map((seedCase) => ({
        id: seedCase.id,
        competitor_id: seedCase.competitor_id,
        category: seedCase.category,
        question: seedCase.question,
        expected_answer: seedCase.expected_answer,
        supporting_chunk_ids: seedCase.supporting_signal_ids,
        confidence_level: seedCase.confidence_level,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const inserted = await tx
      .insert(ragEvalDatasetTable)
      .values(insertRows)
      .onConflictDoNothing({ target: ragEvalDatasetTable.id })
      .returning({ id: ragEvalDatasetTable.id });

    const requestedIds = cases.map((seedCase) => seedCase.id).sort();
    const persisted = await tx
      .select({
        id: ragEvalDatasetTable.id,
        competitor_id: ragEvalDatasetTable.competitor_id,
        category: ragEvalDatasetTable.category,
        question: ragEvalDatasetTable.question,
        expected_answer: ragEvalDatasetTable.expected_answer,
        supporting_chunk_ids: ragEvalDatasetTable.supporting_chunk_ids,
        confidence_level: ragEvalDatasetTable.confidence_level,
      })
      .from(ragEvalDatasetTable)
      .where(inArray(ragEvalDatasetTable.id, requestedIds))
      .orderBy(asc(ragEvalDatasetTable.id));
    const persistedById = new Map(persisted.map((row) => [row.id, row]));
    const conflicts = cases.flatMap((seedCase) => {
      const row = persistedById.get(seedCase.id);
      return !row ||
        row.competitor_id !== seedCase.competitor_id ||
        row.category !== seedCase.category ||
        row.question !== seedCase.question ||
        row.expected_answer !== seedCase.expected_answer ||
        !sameStringArray(row.supporting_chunk_ids, seedCase.supporting_signal_ids) ||
        row.confidence_level !== seedCase.confidence_level
        ? [seedCase.id]
        : [];
    });
    if (conflicts.length > 0) throw new RagEvalSeedConflictError(conflicts);
    return { inserted: inserted.length, unchanged: cases.length - inserted.length };
  });
}

// ── RAG faithfulness evaluation ────────────────────────────────────────────

export type RagEvalCase = {
  id: string;
  competitor_id: string;
  category: RagEvalCategory;
  question: string;
  expected_answer: string;
  supporting_signal_ids: string[];
  confidence_level: RagEvalConfidenceLevel;
  created_at: Date;
};

export type RagEvalCitationSignal = {
  id: string;
  competitor_id: string;
  source: SignalSource;
  title: string;
  raw_text: string;
};

export class RagEvalDatasetIntegrityError extends Error {
  readonly caseId: string;

  constructor(caseId: string, reason: string) {
    super(`RAG eval dataset row ${caseId} failed integrity validation: ${reason}`);
    this.name = "RagEvalDatasetIntegrityError";
    this.caseId = caseId;
  }
}

// scripts/rag-eval.ts must never send a curator placeholder or a legacy-invalid row to a
// paid ChatAgent/judge call — this is a runtime boundary against the raw select, not just
// the seed-time schema which already enforces most of this for freshly seeded rows.
const RagEvalDatasetRowSchema = z
  .object({
    id: z.string().uuid(),
    competitor_id: z.string().uuid(),
    category: RagEvalCategorySchema,
    question: z.string().min(1),
    expected_answer: z.string().min(1),
    supporting_signal_ids: z.array(z.string().uuid()).min(1),
    confidence_level: RagEvalConfidenceLevelSchema,
    created_at: z.date(),
  })
  .superRefine((row, context) => {
    if (row.question.startsWith("STRUCTURAL EXAMPLE ONLY") ||
      row.expected_answer.startsWith("STRUCTURAL EXAMPLE ONLY")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Structural example rows cannot be evaluated",
      });
    }
  });

export async function listRagEvalCases(competitorId?: string): Promise<RagEvalCase[]> {
  const rows = await db
    .select({
      id: ragEvalDatasetTable.id,
      competitor_id: ragEvalDatasetTable.competitor_id,
      category: ragEvalDatasetTable.category,
      question: ragEvalDatasetTable.question,
      expected_answer: ragEvalDatasetTable.expected_answer,
      supporting_signal_ids: ragEvalDatasetTable.supporting_chunk_ids,
      confidence_level: ragEvalDatasetTable.confidence_level,
      created_at: ragEvalDatasetTable.created_at,
    })
    .from(ragEvalDatasetTable)
    .where(competitorId === undefined ? undefined : eq(ragEvalDatasetTable.competitor_id, competitorId))
    .orderBy(asc(ragEvalDatasetTable.created_at), asc(ragEvalDatasetTable.id));

  return rows.map((row) => {
    const validated = RagEvalDatasetRowSchema.safeParse(row);
    if (!validated.success) {
      throw new RagEvalDatasetIntegrityError(
        String(row.id),
        validated.error.issues.map((issue) => issue.message).join("; ")
      );
    }
    return validated.data;
  });
}

// One set-based `WHERE id IN (...)` lookup — never called per-case. `title` is
// nullable in the signals table; RagEvalCitationSignal keeps the field honestly
// present but empty rather than surfacing null through the evaluator/judge boundary.
export async function getRagEvalCitationSignals(
  ids: readonly string[]
): Promise<RagEvalCitationSignal[]> {
  if (ids.length === 0) return [];
  const uniqueIds = [...new Set(ids)];
  const rows = await db
    .select({
      id: signalsTable.id,
      competitor_id: signalsTable.competitor_id,
      source: signalsTable.source,
      title: signalsTable.title,
      raw_text: signalsTable.raw_text,
    })
    .from(signalsTable)
    .where(inArray(signalsTable.id, uniqueIds));

  return rows.map((row) => ({
    id: row.id,
    competitor_id: row.competitor_id,
    source: row.source,
    title: row.title ?? "",
    raw_text: row.raw_text,
  }));
}

export type PersistRagEvaluationInput = {
  run_at: Date;
  threshold: number;
  ci_triggered: boolean;
  git_commit: string | null;
  results: readonly RagEvalResult[];
};

export async function persistRagEvaluation(
  input: PersistRagEvaluationInput
): Promise<{ id: string; summary: RagEvalRunSummary }> {
  if (input.results.length === 0) {
    throw new Error("RAG evaluation persistence requires at least one result");
  }
  // Independently recompute totals/mean from validated results rather than trusting
  // caller-supplied aggregates — the persisted row is the source of truth.
  const parsedResults = input.results.map((result) => RagEvalResultSchema.parse(result));
  const total = parsedResults.length;
  const passed = parsedResults.filter((result) => result.passed).length;
  const failed = total - passed;
  const faithfulnessScore =
    parsedResults.reduce((sum, result) => sum + result.faithfulness_score, 0) / total;

  const runId = await db.transaction(async (tx) => {
    const caseIds = [...new Set(parsedResults.map((result) => result.question_id))].sort();
    const scoreValues = sql.join(
      parsedResults.map(
        (result) => sql`(${result.question_id}::uuid, ${result.faithfulness_score}::real)`
      ),
      sql`, `
    );
    // A single CASE per column: every requested id is matched and returned by the
    // WHERE, but a case whose stored last_evaluated_at is already newer than this
    // run keeps its existing value — a slower concurrent old run cannot clobber a
    // newer one. No per-case UPDATE loop.
    const updateResult = await tx.execute(sql`
      UPDATE ${ragEvalDatasetTable} AS d
      SET
        last_evaluated_at = CASE
          WHEN d.last_evaluated_at IS NULL OR d.last_evaluated_at <= ${input.run_at}
          THEN ${input.run_at}
          ELSE d.last_evaluated_at
        END,
        last_faithfulness_score = CASE
          WHEN d.last_evaluated_at IS NULL OR d.last_evaluated_at <= ${input.run_at}
          THEN v.score
          ELSE d.last_faithfulness_score
        END
      FROM (VALUES ${scoreValues}) AS v(id, score)
      WHERE d.id = v.id
      RETURNING d.id
    `);
    const updatedIds = new Set(updateResult.rows.map((row) => String(row.id)));
    if (updatedIds.size !== caseIds.length || caseIds.some((id) => !updatedIds.has(id))) {
      throw new Error("RAG evaluation dataset case was deleted during evaluation");
    }

    const [inserted] = await tx
      .insert(ragEvalRunsTable)
      .values({
        run_at: input.run_at,
        total_questions: total,
        passed,
        failed,
        faithfulness_score: faithfulnessScore,
        threshold: input.threshold,
        ci_triggered: input.ci_triggered,
        git_commit: input.git_commit,
        results: parsedResults,
      })
      .returning({ id: ragEvalRunsTable.id });
    if (!inserted) throw new Error("RAG evaluation run insert returned no row");
    return inserted.id;
  });

  const summary = RagEvalRunSummarySchema.parse({
    run_at: input.run_at.toISOString(),
    total_questions: total,
    passed,
    failed,
    faithfulness_score: faithfulnessScore,
    threshold: input.threshold,
    ci_triggered: input.ci_triggered,
    git_commit: input.git_commit,
  });
  return { id: runId, summary };
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
  days = 7,
  limit = 500
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
    )
    .orderBy(desc(signalsTable.created_at))
    .limit(analysisInputLimit(limit));
}

// GET /:id/hiring's source query — deliberately NOT getRecentSignalsByCompetitorAndSource
// above: that function's 500-row cap exists to bound an LLM prompt's token budget (dropping
// the oldest rows there is harmless — IntentAnalyzer just sees less context). Reused for a
// recent-vs-prior delta *count* instead, the same cap silently under-counts a real
// heavy-hiring competitor and skews the split toward the recent half. This selects only the
// two columns the delta math needs (lighter payload) with a limit sized for counting, not
// prompting, and the caller can detect truncation via `.length === limit`.
export const HIRING_DELTA_ROW_LIMIT = 5000;

export async function getJobSignalsForHiringDelta(
  competitorId: string,
  days: number,
  limit = HIRING_DELTA_ROW_LIMIT
): Promise<{ title: string | null; created_at: Date }[]> {
  return db
    .select({ title: signalsTable.title, created_at: signalsTable.created_at })
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.competitor_id, competitorId),
        eq(signalsTable.source, "jobs"),
        sql`${signalsTable.created_at} >= NOW() - INTERVAL '1 day' * ${days}`
      )
    )
    .orderBy(desc(signalsTable.created_at))
    .limit(limit);
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
      // as a Date, not a string — ::int/::date make the driver's runtime
      // value match the declared TS type instead of lying about it.
      // AT TIME ZONE 'UTC' before truncating — same reasoning as competitor_signal_scores.day's
      // own comment: DATE_TRUNC on a timestamptz truncates in the *session's* timezone, not
      // UTC, and this pool sets none explicitly (db/client.ts). Every existing caller
      // (synthesis.ts's relative-age math, pattern-detector.ts's display text) tolerated that
      // looseness; the API's GET /:id/trend route does an exact date-string join against an
      // independently UTC-derived key and does not. ::date (not ::text) so node-postgres's
      // default DATE type parser hands back a plain "YYYY-MM-DD" string with no offset for
      // JS to misinterpret — unlike a timestamptz::text cast, which round-trips through
      // `new Date(...)` ambiguously.
      day: sql<string>`DATE_TRUNC('day', ${signalsTable.created_at} AT TIME ZONE 'UTC')::date`,
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
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(signalsTable).values(input).returning();
    await tx.insert(signalPipelineOutboxTable).values({ signal_id: row.id });
    return row;
  });
}

export interface FeedCursor {
  created_at: Date;
  id: string;
}

export interface SignalFeedQuery {
  limit: number;
  workspace_id: string; // new — always required, always enforced below
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

function analysisInputLimit(value: number): number {
  const floored = Math.floor(value);
  return Number.isFinite(floored) ? Math.max(1, Math.min(500, floored)) : 500;
}

// Returns limit + 1 rows so the HTTP boundary can determine whether a next
// cursor exists without a separate COUNT query. The cursor includes both sort
// columns, preventing duplicate/omitted rows when timestamps are equal.
export async function listSignalFeed(input: SignalFeedQuery): Promise<Signal[]> {
  if (input.competitor_ids?.length === 0 || input.sources?.length === 0) return [];

  const predicates: SQL[] = [];
  // Always-AND workspace scope, regardless of client-supplied competitor_ids —
  // a competitor id from another workspace passed here now matches zero rows
  // instead of leaking that workspace's signals.
  predicates.push(
    inArray(
      signalsTable.competitor_id,
      db
        .select({ id: competitorsTable.id })
        .from(competitorsTable)
        .where(eq(competitorsTable.workspace_id, input.workspace_id))
    )
  );
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
  workspace_id: string; // new — always required, always enforced below
  competitor_ids?: string[];
  cursor?: FeedCursor;
}

export async function listAlertFeed(input: AlertFeedQuery): Promise<Alert[]> {
  if (input.competitor_ids?.length === 0) return [];

  const predicates: SQL[] = [];
  // Always-AND workspace scope, regardless of client-supplied competitor_ids —
  // a competitor id from another workspace passed here now matches zero rows
  // instead of leaking that workspace's alerts.
  predicates.push(
    inArray(
      alertsTable.competitor_id,
      db
        .select({ id: competitorsTable.id })
        .from(competitorsTable)
        .where(eq(competitorsTable.workspace_id, input.workspace_id))
    )
  );
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
  days = 7,
  limit = 500
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
    .orderBy(desc(pricingDiffsTable.detected_at))
    .limit(analysisInputLimit(limit));
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

// SynthesisAgent's write — retries replace the same competitor's UTC-day row
// instead of appending a duplicate score.
export async function createSignalScore(input: CreateSignalScoreInput): Promise<SignalScore> {
  const [row] = await db
    .insert(competitorSignalScoresTable)
    .values(input)
    .onConflictDoUpdate({
      target: [
        competitorSignalScoresTable.competitor_id,
        competitorSignalScoresTable.day,
      ],
      set: {
        score: input.score,
        components: input.components,
        delta_7d: input.delta_7d ?? null,
        delta_30d: input.delta_30d ?? null,
        computed_at: sql`now()`,
      },
    })
    .returning();
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

// Operational report source — one set-based aggregation for every agent,
// across both run- and job-attributed spans.
// Failure rate excludes skipped samples because a deliberate no-op is neither
// success nor failure. Percentiles ignore NULL duration_ms by PostgreSQL design.
export async function getAgentLatencyReport(days = 7): Promise<AgentLatencyReportRow[]> {
  return db
    .select({
      agent_name: agentLatenciesTable.agent_name,
      p50: sql<number | null>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${agentLatenciesTable.duration_ms})`,
      p95: sql<number | null>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${agentLatenciesTable.duration_ms})`,
      p99: sql<number | null>`PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${agentLatenciesTable.duration_ms})`,
      mean: sql<number | null>`AVG(${agentLatenciesTable.duration_ms})::float8`,
      sample_count: sql<number>`COUNT(${agentLatenciesTable.duration_ms})::int`,
      failed_count: sql<number>`COUNT(*) FILTER (WHERE ${agentLatenciesTable.status} = 'failed')::int`,
      run_count: sql<number>`COUNT(*) FILTER (WHERE ${agentLatenciesTable.status} IN ('success', 'failed'))::int`,
    })
    .from(agentLatenciesTable)
    .where(sql`${agentLatenciesTable.created_at} >= NOW() - INTERVAL '1 day' * ${days}`)
    .groupBy(agentLatenciesTable.agent_name);
}

// LLM cost is stored as NUMERIC for exact accounting. The report converts the
// six-decimal aggregate to float8 only at this display boundary.
export async function getCostByCompetitorDay(days = 7): Promise<CostByCompetitorDayRow[]> {
  const utcDay = sql<string>`DATE_TRUNC('day', ${llmCostsTable.created_at} AT TIME ZONE 'UTC')::date::text`;
  return db
    .select({
      competitor_id: llmCostsTable.competitor_id,
      day: utcDay,
      cost_usd: sql<number>`SUM(${llmCostsTable.cost_usd})::float8`,
    })
    .from(llmCostsTable)
    .where(sql`${llmCostsTable.created_at} >= NOW() - INTERVAL '1 day' * ${days}`)
    .groupBy(llmCostsTable.competitor_id, utcDay);
}

// ── signal pipeline (Part 7: entity-extractor / quality-scorer / deduplicator) ──
// Collectors (Part 6) only INSERT raw signal rows; these UPDATE the columns each
// pipeline stage populates as a signal moves through it.

const DEFAULT_OUTBOX_BATCH_LIMIT = 100;
const MAX_OUTBOX_BATCH_LIMIT = 500;

function outboxBatchLimit(value: number): number {
  const floored = Math.floor(value);
  return Number.isFinite(floored)
    ? Math.max(1, Math.min(MAX_OUTBOX_BATCH_LIMIT, floored))
    : DEFAULT_OUTBOX_BATCH_LIMIT;
}

export async function listPendingSignalPipelineOutbox(
  limit = DEFAULT_OUTBOX_BATCH_LIMIT
): Promise<SignalPipelineOutbox[]> {
  return db
    .select()
    .from(signalPipelineOutboxTable)
    .orderBy(asc(signalPipelineOutboxTable.created_at))
    .limit(outboxBatchLimit(limit));
}

export async function advanceSignalPipelineOutbox(
  signalId: string,
  expectedStage: SignalPipelineStage,
  nextStage: SignalPipelineStage
): Promise<boolean> {
  const rows = await db
    .update(signalPipelineOutboxTable)
    .set({ stage: nextStage, updated_at: new Date() })
    .where(
      and(
        eq(signalPipelineOutboxTable.signal_id, signalId),
        eq(signalPipelineOutboxTable.stage, expectedStage)
      )
    )
    .returning({ signal_id: signalPipelineOutboxTable.signal_id });
  return rows.length > 0;
}

// Score persistence and stage ownership are one transaction. If a worker advances
// the outbox but cannot enqueue deduplication, a retry/recovery job observes the lost
// compare-and-set and cannot replace the already-committed time-sensitive score.
export async function scoreSignalAndAdvanceOutbox(
  signalId: string,
  qualityScore: number
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const advancedRows = await tx
      .update(signalPipelineOutboxTable)
      .set({ stage: "deduplication", updated_at: new Date() })
      .where(
        and(
          eq(signalPipelineOutboxTable.signal_id, signalId),
          eq(signalPipelineOutboxTable.stage, "quality_scoring")
        )
      )
      .returning({ signal_id: signalPipelineOutboxTable.signal_id });

    if (advancedRows.length === 0) return false;

    await tx
      .update(signalsTable)
      .set({ quality_score: qualityScore })
      .where(eq(signalsTable.id, signalId));
    return true;
  });
}

export async function completeSignalPipelineOutbox(
  signalId: string,
  expectedStage: "deduplication"
): Promise<boolean> {
  const rows = await db
    .delete(signalPipelineOutboxTable)
    .where(
      and(
        eq(signalPipelineOutboxTable.signal_id, signalId),
        eq(signalPipelineOutboxTable.stage, expectedStage)
      )
    )
    .returning({ signal_id: signalPipelineOutboxTable.signal_id });
  return rows.length > 0;
}

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
    .where(and(eq(agentRunsTable.id, runId), eq(agentRunsTable.status, "running")));
}

// A worker timeout is a give-up boundary, not a guarantee that all nested LLM
// calls stopped. Only a still-running row may transition to failed, so late
// graph completion cannot be overwritten by an older timeout handler.
export async function failRunIfRunning(runId: string): Promise<void> {
  await db
    .update(agentRunsTable)
    .set({ status: "failed", completed_at: new Date() })
    .where(and(eq(agentRunsTable.id, runId), eq(agentRunsTable.status, "running")));
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
): Promise<DiscoveryStatus> {
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

  return discoveryStatus;
}

// ── workspaces (Task 2: create/invite/redeem) ───────────────────────────

// createWorkspace + its owner membership row commit together — a failure
// between them would leave a workspace with no owner member, which every
// other workspace query treats as unreachable.
export async function createWorkspace(input: { name: string; ownerId: string }): Promise<Workspace> {
  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspacesTable)
      .values({ name: input.name, owner_id: input.ownerId })
      .returning();
    await tx.insert(workspaceMembersTable).values({
      workspace_id: workspace.id,
      user_id: input.ownerId,
      role: "owner",
    });
    return workspace;
  });
}

// workspace_members_user_id_idx enforces one workspace per user, so this is
// always at most one row.
export async function getWorkspaceIdForUser(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ workspace_id: workspaceMembersTable.workspace_id })
    .from(workspaceMembersTable)
    .where(eq(workspaceMembersTable.user_id, userId));
  return row?.workspace_id ?? null;
}

// ── workspace-scoped tenant-data query variants (Task 3) ────────────────
// Added alongside the unscoped originals above (getCompetitorById,
// getCompetitorsByIds, listCompetitors) — those stay untouched for now since
// background workers still call them. Tasks 6-9 (the routers) call these
// instead. The unscoped createCompetitor was deleted in Task 7: its only
// caller was the competitors router, now rewired to createCompetitorForWorkspace,
// and it would violate competitors.workspace_id's NOT NULL constraint if
// anything called it. Same reasoning removed the unscoped getCompanyProfile/
// upsertCompanyProfile in Task 10 — the company-profile router was their only
// caller, now rewired below, and they'd violate company_profile.workspace_id's
// NOT NULL constraint if anything called them.

export async function getCompetitorByIdForWorkspace(
  id: string,
  workspaceId: string
): Promise<Competitor | undefined> {
  const [row] = await db
    .select()
    .from(competitorsTable)
    .where(and(eq(competitorsTable.id, id), eq(competitorsTable.workspace_id, workspaceId)));
  return row;
}

export async function listCompetitorsForWorkspace(workspaceId: string): Promise<Competitor[]> {
  return db
    .select()
    .from(competitorsTable)
    .where(eq(competitorsTable.workspace_id, workspaceId))
    .orderBy(desc(competitorsTable.created_at));
}

export async function getCompetitorsByIdsForWorkspace(
  ids: string[],
  workspaceId: string
): Promise<Competitor[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(competitorsTable)
    .where(and(inArray(competitorsTable.id, ids), eq(competitorsTable.workspace_id, workspaceId)));
}

export async function createCompetitorForWorkspace(
  input: CompetitorCreateInput,
  workspaceId: string
): Promise<Competitor> {
  const [row] = await db
    .insert(competitorsTable)
    .values({
      workspace_id: workspaceId,
      name: input.name,
      domain: input.domain,
      ...(input.subreddits === undefined ? {} : { subreddits: input.subreddits }),
      ...(input.greenhouse_token === undefined ? {} : { greenhouse_token: input.greenhouse_token }),
      ...(input.lever_token === undefined ? {} : { lever_token: input.lever_token }),
      ...(input.pricing_url === undefined ? {} : { pricing_url: input.pricing_url }),
      ...(input.rss_url === undefined ? {} : { changelog_rss: input.rss_url }),
      discovery_status: "pending",
    })
    .returning();
  return row;
}

// R1: the synthetic own-company row derives `name` from workspaces.name
// (falling back to the literal "Own Company" when unavailable) and `domain`
// from a deterministic per-workspace placeholder `own-company.<workspace_id>.invalid`.
// company_profile has no name/domain columns, so it can't be the source; the real
// discriminator is `is_own_company`, name/domain are cosmetic but must be non-empty
// (competitors.name/domain are NOT NULL) and unique per workspace (unique index on
// workspace_id+domain) — the deterministic placeholder satisfies both.
export async function getOwnCompanyCompetitorForWorkspace(
  workspaceId: string
): Promise<Competitor | null> {
  const [row] = await db
    .select()
    .from(competitorsTable)
    .where(
      and(
        eq(competitorsTable.workspace_id, workspaceId),
        eq(competitorsTable.is_own_company, true)
      )
    );
  return row ?? null;
}

export async function createOwnCompanyCompetitorRow(workspaceId: string): Promise<Competitor> {
  const existing = await getOwnCompanyCompetitorForWorkspace(workspaceId);
  if (existing) return existing;

  const [workspace] = await db
    .select({ name: workspacesTable.name })
    .from(workspacesTable)
    .where(eq(workspacesTable.id, workspaceId));
  const name = workspace?.name || "Own Company";
  const domain = `own-company.${workspaceId}.invalid`;

  const [row] = await db
    .insert(competitorsTable)
    .values({
      workspace_id: workspaceId,
      name,
      domain,
      is_own_company: true,
    })
    .returning();
  return row;
}

export interface TrackedEntityCandidateInput {
  workspace_id: string;
  source: string;
  status: string;
  candidate_name: string;
  candidate_domain: string;
  candidate_reason: string;
}

export async function createTrackedEntityCandidate(
  input: TrackedEntityCandidateInput
): Promise<typeof trackedEntitiesTable.$inferSelect> {
  const [row] = await db
    .insert(trackedEntitiesTable)
    .values({
      workspace_id: input.workspace_id,
      source: input.source,
      status: input.status,
      candidate_name: input.candidate_name,
      candidate_domain: input.candidate_domain,
      candidate_reason: input.candidate_reason,
    })
    .returning();
  return row;
}

export async function getCompanyProfileForWorkspace(workspaceId: string): Promise<CompanyProfile | null> {
  const [row] = await db
    .select()
    .from(companyProfileTable)
    .where(eq(companyProfileTable.workspace_id, workspaceId));
  return row ?? null;
}

export async function upsertCompanyProfileForWorkspace(
  input: CompanyProfileInput,
  workspaceId: string
): Promise<CompanyProfile> {
  const [row] = await db
    .insert(companyProfileTable)
    .values({ ...input, workspace_id: workspaceId })
    .onConflictDoUpdate({
      target: companyProfileTable.workspace_id,
      set: { ...input, updated_at: new Date() },
    })
    .returning();
  return row;
}

export interface CompanyDocumentCreateInput {
  workspace_id: string;
  filename: string;
  mime_type: string;
  doc_type: string;
  extraction_status: string;
  pinecone_namespace?: string | null;
}

export async function createCompanyDocument(
  input: CompanyDocumentCreateInput
): Promise<CompanyDocument> {
  const [row] = await db
    .insert(companyDocumentsTable)
    .values({
      workspace_id: input.workspace_id,
      filename: input.filename,
      mime_type: input.mime_type,
      doc_type: input.doc_type,
      extraction_status: input.extraction_status,
      ...(input.pinecone_namespace === undefined ? {} : { pinecone_namespace: input.pinecone_namespace }),
    })
    .returning();
  return row;
}

export async function createChatThread(
  workspaceId: string,
  title?: string
): Promise<ChatThread> {
  const [row] = await db
    .insert(chatThreadsTable)
    .values({ workspace_id: workspaceId, ...(title === undefined ? {} : { title }) })
    .returning();
  return row;
}

export async function listChatThreadsForWorkspace(
  workspaceId: string
): Promise<ChatThread[]> {
  return db
    .select()
    .from(chatThreadsTable)
    .where(eq(chatThreadsTable.workspace_id, workspaceId))
    .orderBy(desc(chatThreadsTable.updated_at));
}

export async function getChatThreadForWorkspace(
  threadId: string,
  workspaceId: string
): Promise<ChatThread | undefined> {
  const [row] = await db
    .select()
    .from(chatThreadsTable)
    .where(and(eq(chatThreadsTable.id, threadId), eq(chatThreadsTable.workspace_id, workspaceId)));
  return row;
}

export async function deleteChatThreadForWorkspace(
  threadId: string,
  workspaceId: string
): Promise<void> {
  await db
    .delete(chatThreadsTable)
    .where(and(eq(chatThreadsTable.id, threadId), eq(chatThreadsTable.workspace_id, workspaceId)));
}

export async function touchChatThread(threadId: string): Promise<void> {
  await db
    .update(chatThreadsTable)
    .set({ updated_at: new Date() })
    .where(eq(chatThreadsTable.id, threadId));
}
