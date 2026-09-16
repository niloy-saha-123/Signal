// Onboarding (create a workspace). One workspace per user — POST / 409s if
// the caller already has one (req.workspaceId set by requireAuth). Single
// user per workspace for now — no invite/join flow.
import express, { Router } from "express";
import { z } from "zod";
import * as queries from "../db/queries";
import { wrap, fallbackErrorHandler } from "./http";

export interface WorkspaceRouterDeps {
  createWorkspace: typeof queries.createWorkspace;
}

export const defaultWorkspaceRouterDeps: WorkspaceRouterDeps = {
  createWorkspace: queries.createWorkspace,
};

const CreateBodySchema = z.object({ name: z.string().min(1).max(200) }).strict();

export function createWorkspaceRouter(deps: WorkspaceRouterDeps = defaultWorkspaceRouterDeps): Router {
  const router = express.Router();
  router.use(express.json());

  router.post(
    "/",
    wrap(async (req, res) => {
      if (req.workspaceId) {
        res.status(409).json({ error: "already_has_workspace" });
        return;
      }
      const parsed = CreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const workspace = await deps.createWorkspace({ name: parsed.data.name, ownerId: req.user!.id });
      res.status(201).json(workspace);
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
