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
//
// PATCH /competitors/:id — news_query / docs_sitemap_url / npm_packages / pypi_packages /
// blog_feeds / social_feeds / forum_feeds / bluesky_handle / stackoverflow_tag only.
//
// POST /competitors/:id/field-intel — teammate link/note → a 'field' signal.
import express, { Router } from "express";
import { z } from "zod";
import {
  CompetitorCreateInputSchema,
  CompetitorSourceConfigSchema,
  FieldIntelInputSchema,
} from "@signal/shared";
import * as queries from "../db/queries";
import { isPublicHostname } from "../lib/safe-fetch";
import { queues, type QueueName } from "../queues/registry";
import { logger } from "../lib/logger";
import { enqueueInitialSignalPipeline } from "../pipeline/recovery";
import { fetchPublicPageText } from "../agents/chat/fetch-url";
import { consumeChatInputBudget } from "../agents/chat/input-budget";
import {
  computeHiringDeltas,
  loadCompetitorProfile,
  scoreHistory,
  scoreSummary,
  trendSeries,
} from "./competitor-profile";
import { wrap, fallbackErrorHandler, requireUuidParam } from "./http";

// getLatestSignalScores takes a row-count limit, not a day range — one row per day in
// practice, but that's a convention, not a guarantee, so the param is named honestly.
const ScoreHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(90).default(30),
});

const DayRangeQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

// `is_own_company` arrives as a query string ("true"/"false"). `z.coerce.boolean()`
// would truthy-coerce any non-empty value so a malformed value like "maybe" would
// silently become true — parse the two literal forms explicitly and 400 otherwise.
const ListCompetitorsQuerySchema = z.object({
  is_own_company: z
    .preprocess(
      (value) => (value === "true" ? true : value === "false" ? false : value),
      z.boolean().optional()
    ),
});

export interface CompetitorRouterDeps {
  createCompetitorForWorkspace: typeof queries.createCompetitorForWorkspace;
  getCompetitorByIdForWorkspace: typeof queries.getCompetitorByIdForWorkspace;
  updateCompetitorSourceConfigForWorkspace: typeof queries.updateCompetitorSourceConfigForWorkspace;
  listCompetitorsForWorkspace: typeof queries.listCompetitorsForWorkspace;
  getCompetitorDiscoveryLog: typeof queries.getCompetitorDiscoveryLog;
  getLatestSignalScores: typeof queries.getLatestSignalScores;
  getSignalVolumeByDay: typeof queries.getSignalVolumeByDay;
  getJobSignalsForHiringDelta: typeof queries.getJobSignalsForHiringDelta;
  getRecentPricingDiffs: typeof queries.getRecentPricingDiffs;
  listPredictionsForWorkspace: typeof queries.listPredictionsForWorkspace;
  listSignalFeed: typeof queries.listSignalFeed;
  countRoadmapLinksByPrediction: typeof queries.countRoadmapLinksByPrediction;
  createAgentRun: typeof queries.createAgentRun;
  failRunIfRunning: typeof queries.failRunIfRunning;
  enqueue: (queue: QueueName, data: unknown) => Promise<unknown>;
  isPublicHostname: typeof isPublicHostname;
  signalExistsBySourceUrl: typeof queries.signalExistsBySourceUrl;
  createSignal: typeof queries.createSignal;
  enqueueInitialSignalPipeline: typeof enqueueInitialSignalPipeline;
  fetchPublicPageText: typeof fetchPublicPageText;
  consumeBudget: typeof consumeChatInputBudget;
}

export const defaultCompetitorRouterDeps: CompetitorRouterDeps = {
  createCompetitorForWorkspace: queries.createCompetitorForWorkspace,
  getCompetitorByIdForWorkspace: queries.getCompetitorByIdForWorkspace,
  updateCompetitorSourceConfigForWorkspace: queries.updateCompetitorSourceConfigForWorkspace,
  listCompetitorsForWorkspace: queries.listCompetitorsForWorkspace,
  getCompetitorDiscoveryLog: queries.getCompetitorDiscoveryLog,
  getLatestSignalScores: queries.getLatestSignalScores,
  getSignalVolumeByDay: queries.getSignalVolumeByDay,
  getJobSignalsForHiringDelta: queries.getJobSignalsForHiringDelta,
  getRecentPricingDiffs: queries.getRecentPricingDiffs,
  listPredictionsForWorkspace: queries.listPredictionsForWorkspace,
  listSignalFeed: queries.listSignalFeed,
  countRoadmapLinksByPrediction: queries.countRoadmapLinksByPrediction,
  createAgentRun: queries.createAgentRun,
  failRunIfRunning: queries.failRunIfRunning,
  enqueue: (queue, data) => queues[queue].add(queue, data),
  isPublicHostname,
  signalExistsBySourceUrl: queries.signalExistsBySourceUrl,
  createSignal: queries.createSignal,
  enqueueInitialSignalPipeline,
  fetchPublicPageText,
  consumeBudget: consumeChatInputBudget,
};

const FIELD_PAGE_MAX_CHARS = 12_000;

function fieldIntelText(note: string, url: string | undefined, pageText: string | null): string {
  const parts = [`Teammate note: ${note}`];
  if (url && pageText) parts.push(`Linked page (${url}):\n${pageText.slice(0, FIELD_PAGE_MAX_CHARS)}`);
  return parts.join("\n\n");
}

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

async function allPublic(
  urls: string[] | undefined,
  isPublic: CompetitorRouterDeps["isPublicHostname"]
): Promise<boolean> {
  if (!urls?.length) return true;
  return (await Promise.all(urls.map((url) => overrideUrlIsPublic(url, isPublic)))).every(Boolean);
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

      const [pricingOk, rssOk, sitemapOk, blogOk, socialOk, forumOk] = await Promise.all([
        overrideUrlIsPublic(parsed.data.pricing_url, deps.isPublicHostname),
        overrideUrlIsPublic(parsed.data.rss_url, deps.isPublicHostname),
        overrideUrlIsPublic(parsed.data.docs_sitemap_url, deps.isPublicHostname),
        allPublic(parsed.data.blog_feeds, deps.isPublicHostname),
        allPublic(parsed.data.social_feeds, deps.isPublicHostname),
        allPublic(parsed.data.forum_feeds, deps.isPublicHostname),
      ]);
      if (!pricingOk || !rssOk || !sitemapOk || !blogOk || !socialOk || !forumOk) {
        res.status(400).json({
          error: "validation",
          message: "pricing_url/rss_url/docs_sitemap_url/feed URLs must be public URLs",
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
      const parsed = ListCompetitorsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const competitors = await deps.listCompetitorsForWorkspace(req.workspaceId!);
      const { is_own_company } = parsed.data;
      res
        .status(200)
        .json(
          is_own_company === undefined
            ? competitors
            : competitors.filter((row) => row.is_own_company === is_own_company)
        );
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

  router.patch(
    "/:id",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const parsed = CompetitorSourceConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      // The docs collector fetches this URL on a schedule — same SSRF gate as
      // the create-time overrides.
      if (!(await overrideUrlIsPublic(parsed.data.docs_sitemap_url ?? undefined, deps.isPublicHostname))) {
        res.status(400).json({ error: "validation", message: "docs_sitemap_url must be a public URL" });
        return;
      }
      const feedChecks = await Promise.all([
        allPublic(parsed.data.blog_feeds, deps.isPublicHostname),
        allPublic(parsed.data.social_feeds, deps.isPublicHostname),
        allPublic(parsed.data.forum_feeds, deps.isPublicHostname),
      ]);
      if (!feedChecks.every(Boolean)) {
        res.status(400).json({ error: "validation", message: "feed URLs must be public URLs" });
        return;
      }
      const row = await deps.updateCompetitorSourceConfigForWorkspace(id, req.workspaceId!, parsed.data);
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
    "/:id/profile",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const profile = await loadCompetitorProfile(req.workspaceId!, id, deps);
      if (!profile) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(200).json(profile);
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
      res.status(200).json(scoreSummary(scores));
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
      const scores = await deps.getLatestSignalScores(id, parsedLimit.data.limit);
      res.status(200).json({ data: scoreHistory(scores, id) });
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
      res.status(200).json({ data: trendSeries(scores, volumeByDay, id) });
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

  router.post(
    "/:id/field-intel",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const parsed = FieldIntelInputSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const competitor = await deps.getCompetitorByIdForWorkspace(id, req.workspaceId!);
      if (!competitor) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      try {
        await deps.consumeBudget("field_intel", req.workspaceId!);
      } catch {
        res.status(429).json({ error: "rate_limited" });
        return;
      }

      const { note, url } = parsed.data;
      if (url && (await deps.signalExistsBySourceUrl(id, "field", url))) {
        res.status(409).json({ error: "duplicate_url" });
        return;
      }

      // The note is the teammate's evidence; the page is context. A page that
      // can't be fetched (private host, video, outage) never loses the note.
      let pageText: string | null = null;
      if (url) {
        try {
          pageText = (await deps.fetchPublicPageText(url, `field:fetch_url:${req.workspaceId}`)) || null;
        } catch (err) {
          logger.warn("field intel page fetch failed — saving the note alone", {
            competitor_id: id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const signal = await deps.createSignal({
        competitor_id: id,
        source: "field",
        source_url: url ?? null,
        title: note.split("\n")[0].slice(0, 120),
        raw_text: fieldIntelText(note, url, pageText),
      });
      // Lost a race with a concurrent submission of the same URL.
      if (!signal) {
        res.status(409).json({ error: "duplicate_url" });
        return;
      }
      try {
        await deps.enqueueInitialSignalPipeline(signal.id);
      } catch (err) {
        // createSignal wrote the outbox row in the same transaction;
        // pipeline-recovery re-enqueues it.
        logger.error("Failed to enqueue field intel pipeline — recovery will retry", {
          signal_id: signal.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      res.status(201).json({ signal_id: signal.id, fetched: pageText !== null });
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
