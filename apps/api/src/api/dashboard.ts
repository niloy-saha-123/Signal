import express, { Router } from "express";
import { getDashboardSummaryForWorkspace } from "../db/queries";
import { wrap, fallbackErrorHandler } from "./http";

export interface DashboardRouterDeps {
  getDashboardSummaryForWorkspace: typeof getDashboardSummaryForWorkspace;
}

export const defaultDashboardRouterDeps: DashboardRouterDeps = {
  getDashboardSummaryForWorkspace,
};

export function createDashboardRouter(
  deps: DashboardRouterDeps = defaultDashboardRouterDeps
): Router {
  const router = express.Router();
  router.use(express.json());
  router.use((req, res, next) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "no_workspace" });
      return;
    }
    next();
  });

  router.get(
    "/summary",
    wrap(async (req, res) => {
      const summary = await deps.getDashboardSummaryForWorkspace(req.workspaceId!);
      res.status(200).json(summary);
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
