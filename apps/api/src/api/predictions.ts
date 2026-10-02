// Express routes for the prediction ledger and the calibration scorecard.
//
//   GET  /api/predictions                  filterable list
//   GET  /api/predictions/calibration      the workspace's track record
//   GET  /api/predictions/:id              one prediction, evidence hydrated
//   POST /api/predictions/:id/void         mark a prediction moot
//   POST   /api/predictions/:id/links         attach a roadmap link
//   PATCH  /api/predictions/:id/links/:linkId change its stance
//   DELETE /api/predictions/:id/links/:linkId remove it
//
// Route order matters: /calibration is declared before /:id, or Express matches
// the literal path against the id parameter and the scorecard becomes a 400 on
// "calibration is not a uuid".
//
// Every handler resolves req.workspaceId and passes it into the query rather
// than filtering after the fetch, so a row belonging to another workspace is
// never loaded in the first place. A prediction the caller does not own answers
// 404, not 403 — a 403 confirms the id exists, which tells them something true
// about another workspace's ledger.
import express, { Router } from "express";
import { z } from "zod";
import {
  PredictionStatusSchema,
  PredictionPatternTypeSchema,
  RoadmapLinkCreateSchema,
  RoadmapLinkUpdateSchema,
  MAX_ROADMAP_LINKS_PER_PREDICTION,
} from "@signal/shared";
import * as queries from "../db/queries";
import { logger } from "../lib/logger";
import { wrap, fallbackErrorHandler } from "./http";

export interface PredictionRouterDeps {
  listPredictionsForWorkspace: typeof queries.listPredictionsForWorkspace;
  getPredictionForWorkspace: typeof queries.getPredictionForWorkspace;
  getCalibration: typeof queries.getCalibration;
  voidPredictionForWorkspace: typeof queries.voidPredictionForWorkspace;
  getSignalsByIds: typeof queries.getSignalsByIds;
  listRoadmapLinks: typeof queries.listRoadmapLinks;
  countRoadmapLinks: typeof queries.countRoadmapLinks;
  countRoadmapLinksByPrediction: typeof queries.countRoadmapLinksByPrediction;
  createRoadmapLink: typeof queries.createRoadmapLink;
  updateRoadmapLink: typeof queries.updateRoadmapLink;
  deleteRoadmapLink: typeof queries.deleteRoadmapLink;
}

export const defaultPredictionRouterDeps: PredictionRouterDeps = {
  listPredictionsForWorkspace: queries.listPredictionsForWorkspace,
  getPredictionForWorkspace: queries.getPredictionForWorkspace,
  getCalibration: queries.getCalibration,
  voidPredictionForWorkspace: queries.voidPredictionForWorkspace,
  getSignalsByIds: queries.getSignalsByIds,
  listRoadmapLinks: queries.listRoadmapLinks,
  countRoadmapLinks: queries.countRoadmapLinks,
  countRoadmapLinksByPrediction: queries.countRoadmapLinksByPrediction,
  createRoadmapLink: queries.createRoadmapLink,
  updateRoadmapLink: queries.updateRoadmapLink,
  deleteRoadmapLink: queries.deleteRoadmapLink,
};

// .strict() so an unknown query parameter is a 400 rather than a silent no-op.
// A filter the server quietly drops shows the user a different set of
// predictions than the one they asked for, which is worse than an error.
const ListQuerySchema = z
  .object({
    status: PredictionStatusSchema.optional(),
    pattern_type: PredictionPatternTypeSchema.optional(),
    competitor_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const CalibrationQuerySchema = z
  .object({
    competitor_id: z.string().uuid().optional(),
    pattern_type: PredictionPatternTypeSchema.optional(),
  })
  .strict();

const IdParamSchema = z.object({ id: z.string().uuid() });
const LinkParamSchema = z.object({ id: z.string().uuid(), linkId: z.string().uuid() });

export function createPredictionRouter(
  deps: PredictionRouterDeps = defaultPredictionRouterDeps
): Router {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "no_workspace" });
      return;
    }
    next();
  });

  router.get(
    "/",
    wrap(async (req, res) => {
      const parsed = ListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }

      const data = await deps.listPredictionsForWorkspace({
        workspace_id: req.workspaceId!,
        status: parsed.data.status,
        pattern_type: parsed.data.pattern_type,
        competitor_id: parsed.data.competitor_id,
        limit: parsed.data.limit,
      });

      const counts = await deps
        .countRoadmapLinksByPrediction(
          data.map((p) => p.id),
          req.workspaceId!
        )
        .catch((error) => {
          logger.warn("predictions list: roadmap link counts failed", {
            workspace_id: req.workspaceId,
            error: error instanceof Error ? error.message : String(error),
          });
          return new Map<string, number>();
        });
      res.status(200).json({
        data: data.map((p) => ({ ...p, roadmap_link_count: counts.get(p.id) ?? 0 })),
      });
    })
  );

  // Declared before /:id — see the file header.
  router.get(
    "/calibration",
    wrap(async (req, res) => {
      const parsed = CalibrationQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }

      const calibration = await deps.getCalibration(req.workspaceId!, {
        competitorId: parsed.data.competitor_id,
        patternType: parsed.data.pattern_type,
      });

      res.status(200).json(calibration);
    })
  );

  router.get(
    "/:id",
    wrap(async (req, res) => {
      const parsed = IdParamSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }

      const prediction = await deps.getPredictionForWorkspace(parsed.data.id, req.workspaceId!);
      if (!prediction) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      // The evidence set is the reason a prediction is trustworthy, so the
      // detail view hydrates it rather than making the client fetch signals
      // one id at a time.
      const [evidence, roadmap_links] = await Promise.all([
        prediction.evidence_signal_ids.length > 0
          ? deps.getSignalsByIds(prediction.evidence_signal_ids)
          : [],
        deps.listRoadmapLinks(prediction.id, req.workspaceId!).catch((error) => {
          logger.warn("prediction detail: roadmap links failed", {
            workspace_id: req.workspaceId,
            error: error instanceof Error ? error.message : String(error),
          });
          return [];
        }),
      ]);

      res.status(200).json({ ...prediction, evidence, roadmap_links });
    })
  );

  router.post(
    "/:id/void",
    wrap(async (req, res) => {
      const parsed = IdParamSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }

      const voided = await deps.voidPredictionForWorkspace(parsed.data.id, req.workspaceId!);
      if (!voided) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      res.status(200).json({ id: parsed.data.id, status: "void" });
    })
  );

  router.post(
    "/:id/links",
    wrap(async (req, res) => {
      const params = IdParamSchema.safeParse(req.params);
      const body = RoadmapLinkCreateSchema.safeParse(req.body);
      if (!params.success || !body.success) {
        res.status(400).json({ error: "validation", issues: (params.error ?? body.error)?.issues });
        return;
      }
      const prediction = await deps.getPredictionForWorkspace(params.data.id, req.workspaceId!);
      if (!prediction) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      // ponytail: count-then-insert; two concurrent adds can reach 11. A row
      // lock or trigger if the cap ever has to be exact.
      if ((await deps.countRoadmapLinks(prediction.id, req.workspaceId!)) >= MAX_ROADMAP_LINKS_PER_PREDICTION) {
        res.status(409).json({ error: "link_limit" });
        return;
      }
      const link = await deps.createRoadmapLink({
        title: body.data.title,
        url: body.data.url,
        stance: body.data.stance,
        workspace_id: req.workspaceId!,
        prediction_id: prediction.id,
        created_by: req.user?.id ?? null,
      });
      res.status(201).json(link);
    })
  );

  router.patch(
    "/:id/links/:linkId",
    wrap(async (req, res) => {
      const params = LinkParamSchema.safeParse(req.params);
      const body = RoadmapLinkUpdateSchema.safeParse(req.body);
      if (!params.success || !body.success) {
        res.status(400).json({ error: "validation", issues: (params.error ?? body.error)?.issues });
        return;
      }
      const link = await deps.updateRoadmapLink(params.data.linkId, params.data.id, req.workspaceId!, body.data);
      if (!link) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(200).json(link);
    })
  );

  router.delete(
    "/:id/links/:linkId",
    wrap(async (req, res) => {
      const params = LinkParamSchema.safeParse(req.params);
      if (!params.success) {
        res.status(400).json({ error: "validation", issues: params.error.issues });
        return;
      }
      const deleted = await deps.deleteRoadmapLink(params.data.linkId, params.data.id, req.workspaceId!);
      if (!deleted) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(204).end();
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
