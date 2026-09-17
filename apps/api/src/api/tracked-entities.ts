import express, { Router } from "express";
import { listTrackedEntitiesForWorkspace } from "../db/queries";
import { wrap, fallbackErrorHandler } from "./http";

export interface TrackedEntitiesRouterDeps {
  listTrackedEntitiesForWorkspace: typeof listTrackedEntitiesForWorkspace;
}

export const defaultTrackedEntitiesRouterDeps: TrackedEntitiesRouterDeps = {
  listTrackedEntitiesForWorkspace,
};

export function createTrackedEntitiesRouter(
  deps: TrackedEntitiesRouterDeps = defaultTrackedEntitiesRouterDeps
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
    "/",
    wrap(async (req, res) => {
      const entities = await deps.listTrackedEntitiesForWorkspace(req.workspaceId!);
      res.status(200).json(entities);
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
