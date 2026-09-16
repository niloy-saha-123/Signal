// Express routes for competitor CRUD and triggering manual analysis runs.
// GET /competitors/:id/score — current Signal Score, component breakdown, and 7d/30d delta.
// GET /competitors/:id/scores — up to `limit` (default 30) most recent score rows, oldest
//   first, for sparklines/trend charts. See @signal/shared's SignalScoreSchema for the shape.
//
// POST /competitors
//   1. Validate body with CompetitorCreateInput (name + domain required,
//      subreddits/greenhouse_token/lever_token/pricing_url/rss_url optional —
//      pass any of them to skip discovery for that specific field)
//   2. Insert the competitors row with discovery_status = 'pending'
//   3. Enqueue a 'competitor-discovery' BullMQ job:
//      { competitor_id, name, domain }
//   4. Return 201 with the created row, including discovery_status: 'pending'
//      so the frontend can render a "discovering..." state immediately
//
// GET /competitors/:id/discovery
//   Returns the competitor_discovery_log rows for this competitor id
//   (ordered by discovered_at) — one row per field CompetitorDiscoveryAgent
//   attempted, with what it tried and what it found (or didn't). Polled by
//   DiscoveryStatus.tsx every 3s while discovery_status is pending/in_progress.
import express, { Router } from "express";
import { z } from "zod";
import { CompetitorCreateInputSchema, SignalScoreComponentsSchema } from "@signal/shared";
import * as queries from "../db/queries";
import { isPublicHostname } from "../lib/safe-fetch";
import { queues, type QueueName } from "../queues/registry";
import { logger } from "../lib/logger";
import { wrap, fallbackErrorHandler, requireUuidParam } from "./http";

// getLatestSignalScores takes a row-count limit, not a day range — one row per day in
// practice, but that's a convention, not a guarantee, so the param is named honestly.
const ScoreHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(90).default(30),
});

const DayRangeQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

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
function computeHiringDeltas(
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

export interface CompetitorRouterDeps {
  createCompetitorForWorkspace: typeof queries.createCompetitorForWorkspace;
  getCompetitorByIdForWorkspace: typeof queries.getCompetitorByIdForWorkspace;
  listCompetitorsForWorkspace: typeof queries.listCompetitorsForWorkspace;
  getCompetitorDiscoveryLog: typeof queries.getCompetitorDiscoveryLog;
  getLatestSignalScores: typeof queries.getLatestSignalScores;
  getSignalVolumeByDay: typeof queries.getSignalVolumeByDay;
  getJobSignalsForHiringDelta: typeof queries.getJobSignalsForHiringDelta;
  getRecentPricingDiffs: typeof queries.getRecentPricingDiffs;
  createAgentRun: typeof queries.createAgentRun;
  failRunIfRunning: typeof queries.failRunIfRunning;
  enqueue: (queue: QueueName, data: unknown) => Promise<unknown>;
  isPublicHostname: typeof isPublicHostname;
}

export const defaultCompetitorRouterDeps: CompetitorRouterDeps = {
  createCompetitorForWorkspace: queries.createCompetitorForWorkspace,
  getCompetitorByIdForWorkspace: queries.getCompetitorByIdForWorkspace,
  listCompetitorsForWorkspace: queries.listCompetitorsForWorkspace,
  getCompetitorDiscoveryLog: queries.getCompetitorDiscoveryLog,
  getLatestSignalScores: queries.getLatestSignalScores,
  getSignalVolumeByDay: queries.getSignalVolumeByDay,
  getJobSignalsForHiringDelta: queries.getJobSignalsForHiringDelta,
  getRecentPricingDiffs: queries.getRecentPricingDiffs,
  createAgentRun: queries.createAgentRun,
  failRunIfRunning: queries.failRunIfRunning,
  enqueue: (queue, data) => queues[queue].add(queue, data),
  isPublicHostname,
};

const CreateBodySchema = CompetitorCreateInputSchema.strict();

// pricing_url / rss_url are operator-supplied overrides that feed the scheduled
// collectors — an internal/loopback target here is an SSRF vector (review sec-L3).
async function overrideUrlIsPublic(
  url: string | undefined,
  isPublic: CompetitorRouterDeps["isPublicHostname"]
): Promise<boolean> {
  if (url === undefined) return true;
  let host: string;
  try {
    const parsed = new URL(url);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return false;
    }
    host = parsed.hostname;
  } catch {
    return false;
  }
  return isPublic(host);
}

export function createCompetitorRouter(
  deps: CompetitorRouterDeps = defaultCompetitorRouterDeps
): Router {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "no_workspace" });
      return;
    }
    next();
  });
  router.use(express.json());

  router.post(
    "/",
    wrap(async (req, res) => {
      const parsed = CreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }

      const [pricingOk, rssOk] = await Promise.all([
        overrideUrlIsPublic(parsed.data.pricing_url, deps.isPublicHostname),
        overrideUrlIsPublic(parsed.data.rss_url, deps.isPublicHostname),
      ]);
      if (!pricingOk || !rssOk) {
        res.status(400).json({
          error: "validation",
          message: "pricing_url/rss_url must be a public URL",
        });
        return;
      }

      const row = await deps.createCompetitorForWorkspace(parsed.data, req.workspaceId!);

      // Enqueue only after the insert has committed (plan ruling 4). The row
      // exists regardless of what the queue does — a failure here is surfaced
      // and logged, never rolled back.
      try {
        await deps.enqueue("competitor-discovery", {
          competitor_id: row.id,
          name: row.name,
          domain: row.domain,
        });
      } catch (err) {
        logger.error("Failed to enqueue competitor-discovery", {
          competitor_id: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({ error: "enqueue_failed", competitor_id: row.id });
        return;
      }

      res.status(201).json(row);
    })
  );

  router.get(
    "/",
    wrap(async (req, res) => {
      res.status(200).json(await deps.listCompetitorsForWorkspace(req.workspaceId!));
    })
  );

  router.get(
    "/:id",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const row = await deps.getCompetitorByIdForWorkspace(id, req.workspaceId!);
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(200).json(row);
    })
  );

  router.get(
    "/:id/discovery",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const competitor = await deps.getCompetitorByIdForWorkspace(id, req.workspaceId!);
      if (!competitor) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(200).json({
        discovery_status: competitor.discovery_status,
        log: await deps.getCompetitorDiscoveryLog(id),
      });
    })
  );

  router.get(
    "/:id/score",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const competitor = await deps.getCompetitorByIdForWorkspace(id, req.workspaceId!);
      if (!competitor) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const scores = await deps.getLatestSignalScores(id, 30);
      if (scores.length === 0) {
        res.status(404).json({ error: "no_score", message: "No Signal Score computed yet." });
        return;
      }
      const latest = scores[0];
      const parsedComponents = SignalScoreComponentsSchema.safeParse(latest.components);
      if (!parsedComponents.success) {
        logger.warn("Signal score row has malformed components — returning zeroed defaults", {
          competitor_id: id,
          score_id: latest.id,
        });
      }
      res.status(200).json({
        score: latest.score,
        components: parsedComponents.success ? parsedComponents.data : DEFAULT_SCORE_COMPONENTS,
        computed_at: latest.computed_at,
        delta_7d: latest.delta_7d ?? null,
        delta_30d: latest.delta_30d ?? null,
      });
    })
  );

  router.get(
    "/:id/scores",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const parsedLimit = ScoreHistoryQuerySchema.safeParse(req.query);
      if (!parsedLimit.success) {
        res.status(400).json({ error: "validation", issues: parsedLimit.error.issues });
        return;
      }
      const competitor = await deps.getCompetitorByIdForWorkspace(id, req.workspaceId!);
      if (!competitor) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      // Newest-first from the query — reverse to chronological order, the shape every
      // sparkline/trend chart on the frontend expects.
      const scores = (await deps.getLatestSignalScores(id, parsedLimit.data.limit)).reverse();
      res.status(200).json({
        data: scores.map((row) => {
          const parsedComponents = SignalScoreComponentsSchema.safeParse(row.components);
          if (!parsedComponents.success) {
            logger.warn("Signal score row has malformed components — returning zeroed defaults", {
              competitor_id: id,
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
        }),
      });
    })
  );

  // Radar page's TrendChart — merges score/sentiment history (one row/day in practice) with
  // mention-volume-by-day into one combined series. Score rows are the primary axis; a day
  // with a score but no signals defaults mention_volume to 0.
  router.get(
    "/:id/trend",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const parsedQuery = DayRangeQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: "validation", issues: parsedQuery.error.issues });
        return;
      }
      const competitor = await deps.getCompetitorByIdForWorkspace(id, req.workspaceId!);
      if (!competitor) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const { days } = parsedQuery.data;
      const [scores, volumeByDay] = await Promise.all([
        deps.getLatestSignalScores(id, days),
        deps.getSignalVolumeByDay(id, days),
      ]);
      // getSignalVolumeByDay's `day` is already a plain UTC "YYYY-MM-DD" string (a Postgres
      // ::date cast, not ::text) — no Date round-trip needed or wanted here, that's exactly
      // the timezone-ambiguous parsing this join used to be exposed to.
      const volumeByDate = new Map(volumeByDay.map((row) => [row.day, row.count]));
      const chronological = [...scores].reverse();
      res.status(200).json({
        data: chronological.map((row) => {
          const date = row.computed_at.toISOString().slice(0, 10);
          const parsedComponents = SignalScoreComponentsSchema.safeParse(row.components);
          if (!parsedComponents.success) {
            logger.warn("Signal score row has malformed components — defaulting sentiment to 0", {
              competitor_id: id,
              score_id: row.id,
            });
          }
          return {
            date,
            mention_volume: volumeByDate.get(date) ?? 0,
            sentiment: parsedComponents.success ? parsedComponents.data.sentiment_trajectory : 0,
            score: row.score,
          };
        }),
      });
    })
  );

  // Radar page's HiringChart — recent-half vs. prior-half job-posting counts per
  // keyword-classified department. See computeHiringDeltas/classifyDepartment above.
  router.get(
    "/:id/hiring",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const parsedQuery = DayRangeQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: "validation", issues: parsedQuery.error.issues });
        return;
      }
      const competitor = await deps.getCompetitorByIdForWorkspace(id, req.workspaceId!);
      if (!competitor) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const { days } = parsedQuery.data;
      const jobSignals = await deps.getJobSignalsForHiringDelta(id, days);
      if (jobSignals.length === queries.HIRING_DELTA_ROW_LIMIT) {
        logger.warn("Hiring delta query hit its row cap — deltas may under-count", {
          competitor_id: id,
          days,
          limit: queries.HIRING_DELTA_ROW_LIMIT,
        });
      }
      res.status(200).json({ data: computeHiringDeltas(jobSignals, days, Date.now()) });
    })
  );

  router.post(
    "/:id/analyze",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const competitor = await deps.getCompetitorByIdForWorkspace(id, req.workspaceId!);
      if (!competitor) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      const run = await deps.createAgentRun({ competitor_id: id, trigger: "manual" });
      let enqueueAttempted = false;
      try {
        const has_pricing_diff = (await deps.getRecentPricingDiffs(id, 7)).length > 0;
        enqueueAttempted = true;
        await deps.enqueue("analysis", {
          competitor_id: id,
          workspace_id: competitor.workspace_id,
          run_id: run.id,
          has_pricing_diff,
        });
      } catch (err) {
        logger.error("Failed to prepare or enqueue analysis", {
          competitor_id: id,
          run_id: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
        // The row committed before any Redis work. Close it conditionally on
        // every pre-202 failure, without risking a late worker completion.
        await deps.failRunIfRunning(run.id).catch((failureWriteError) => {
          logger.error("Failed to close orphaned analysis run", {
            run_id: run.id,
            error:
              failureWriteError instanceof Error
                ? failureWriteError.message
                : String(failureWriteError),
          });
        });
        res.status(500).json({
          error: enqueueAttempted ? "enqueue_failed" : "internal",
          run_id: run.id,
        });
        return;
      }

      res.status(202).json({ run_id: run.id, status: "running" });
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
