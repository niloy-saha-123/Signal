// Express routes for the prediction ledger and the calibration scorecard.
//
//   GET  /api/predictions                  filterable list
//   GET  /api/predictions/calibration      the workspace's track record
//   GET  /api/predictions/:id              one prediction, evidence hydrated
//   POST /api/predictions/:id/void         mark a prediction moot
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
} from "@signal/shared";
import * as queries from "../db/queries";
import { wrap, fallbackErrorHandler } from "./http";

export interface PredictionRouterDeps {
  listPredictionsForWorkspace: typeof queries.listPredictionsForWorkspace;
  getPredictionForWorkspace: typeof queries.getPredictionForWorkspace;
  getCalibration: typeof queries.getCalibration;
  voidPredictionForWorkspace: typeof queries.voidPredictionForWorkspace;
  getSignalsByIds: typeof queries.getSignalsByIds;
}

export const defaultPredictionRouterDeps: PredictionRouterDeps = {
  listPredictionsForWorkspace: queries.listPredictionsForWorkspace,
  getPredictionForWorkspace: queries.getPredictionForWorkspace,
  getCalibration: queries.getCalibration,
  voidPredictionForWorkspace: queries.voidPredictionForWorkspace,
  getSignalsByIds: queries.getSignalsByIds,
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

      res.status(200).json({ data });
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
      const evidence =
        prediction.evidence_signal_ids.length > 0
          ? await deps.getSignalsByIds(prediction.evidence_signal_ids)
          : [];

      res.status(200).json({ ...prediction, evidence });
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

  router.use(fallbackErrorHandler);
  return router;
}
