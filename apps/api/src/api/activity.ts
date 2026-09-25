// Agent activity — what the system is actually doing, for the workspace asking.
//
// No competitor in this category shows this, and that is the reason it exists:
// a product that claims to run autonomously has to let you watch it run, or the
// claim is just a sentence on a marketing page. Recent runs, today's model
// spend against the budget, and which dependencies are currently circuit-broken.
//
// Everything here is workspace-scoped at the query layer. The existing latency
// and cost report helpers take only a day count and span every tenant — useful
// for an operator on the CLI, unsafe to put behind an HTTP route.
import express, { Router } from "express";
import * as queries from "../db/queries";
import { wrap, fallbackErrorHandler } from "./http";

export interface ActivityRouterDeps {
  getWorkspaceActivity: typeof queries.getWorkspaceActivity;
}

export const defaultActivityRouterDeps: ActivityRouterDeps = {
  getWorkspaceActivity: queries.getWorkspaceActivity,
};

export function createActivityRouter(
  deps: ActivityRouterDeps = defaultActivityRouterDeps
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
      const activity = await deps.getWorkspaceActivity(req.workspaceId!);
      res.status(200).json(activity);
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
