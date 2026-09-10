// Express routes for competitor CRUD and triggering manual analysis runs.
// GET /competitors/:id/score — current Signal Score, component breakdown, and 7d/30d delta.
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
import { CompetitorCreateInputSchema } from "@signal/shared";
import * as queries from "../db/queries";
import { isPublicHostname } from "../lib/safe-fetch";
import { queues, type QueueName } from "../queues/registry";
import { logger } from "../lib/logger";
import { wrap, fallbackErrorHandler, requireUuidParam } from "./http";

export interface CompetitorRouterDeps {
  createCompetitor: typeof queries.createCompetitor;
  getCompetitorById: typeof queries.getCompetitorById;
  listCompetitors: typeof queries.listCompetitors;
  getCompetitorDiscoveryLog: typeof queries.getCompetitorDiscoveryLog;
  getLatestSignalScores: typeof queries.getLatestSignalScores;
  getRecentPricingDiffs: typeof queries.getRecentPricingDiffs;
  createAgentRun: typeof queries.createAgentRun;
  completeAgentRun: typeof queries.completeAgentRun;
  enqueue: (queue: QueueName, data: unknown) => Promise<unknown>;
  isPublicHostname: typeof isPublicHostname;
}

export const defaultCompetitorRouterDeps: CompetitorRouterDeps = {
  createCompetitor: queries.createCompetitor,
  getCompetitorById: queries.getCompetitorById,
  listCompetitors: queries.listCompetitors,
  getCompetitorDiscoveryLog: queries.getCompetitorDiscoveryLog,
  getLatestSignalScores: queries.getLatestSignalScores,
  getRecentPricingDiffs: queries.getRecentPricingDiffs,
  createAgentRun: queries.createAgentRun,
  completeAgentRun: queries.completeAgentRun,
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
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return isPublic(host);
}

export function createCompetitorRouter(
  deps: CompetitorRouterDeps = defaultCompetitorRouterDeps
): Router {
  const router = express.Router();
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

      const row = await deps.createCompetitor(parsed.data);

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
    wrap(async (_req, res) => {
      res.status(200).json(await deps.listCompetitors());
    })
  );

  router.get(
    "/:id",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const row = await deps.getCompetitorById(id);
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
      const competitor = await deps.getCompetitorById(id);
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
      const competitor = await deps.getCompetitorById(id);
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
      res.status(200).json({
        score: latest.score,
        components: latest.components,
        computed_at: latest.computed_at,
        delta_7d: latest.delta_7d ?? null,
        delta_30d: latest.delta_30d ?? null,
      });
    })
  );

  router.post(
    "/:id/analyze",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (id === null) return;
      const competitor = await deps.getCompetitorById(id);
      if (!competitor) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      const run = await deps.createAgentRun({ competitor_id: id, trigger: "manual" });
      const has_pricing_diff = (await deps.getRecentPricingDiffs(id, 7)).length > 0;

      try {
        await deps.enqueue("analysis", { competitor_id: id, run_id: run.id, has_pricing_diff });
      } catch (err) {
        logger.error("Failed to enqueue analysis", {
          competitor_id: id,
          run_id: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
        await deps.completeAgentRun(run.id, "failed");
        res.status(500).json({ error: "enqueue_failed", run_id: run.id });
        return;
      }

      res.status(202).json({ run_id: run.id, status: "running" });
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
