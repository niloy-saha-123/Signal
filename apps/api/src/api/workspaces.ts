// Onboarding (create a workspace) + read/rename the caller's current workspace.
// One workspace per user — POST / 409s if the caller already has one
// (req.workspaceId set by requireAuth). Single user per workspace for now — no
// invite/join flow.
import express, { Router } from "express";
import { z } from "zod";
import * as queries from "../db/queries";
import { wrap, fallbackErrorHandler } from "./http";

export interface WorkspaceRouterDeps {
  createWorkspace: typeof queries.createWorkspace;
  getWorkspaceById: typeof queries.getWorkspaceById;
  renameWorkspace: typeof queries.renameWorkspace;
}

export const defaultWorkspaceRouterDeps: WorkspaceRouterDeps = {
  createWorkspace: queries.createWorkspace,
  getWorkspaceById: queries.getWorkspaceById,
  renameWorkspace: queries.renameWorkspace,
};

const CreateBodySchema = z.object({ name: z.string().min(1).max(200) }).strict();
const RenameBodySchema = z.object({ name: z.string().min(1).max(200) }).strict();

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

  router.get(
    "/",
    wrap(async (req, res) => {
      if (!req.workspaceId) {
        res.status(403).json({ error: "no_workspace" });
        return;
      }
      const workspace = await deps.getWorkspaceById(req.workspaceId);
      if (!workspace) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(200).json(workspace);
    })
  );

  router.patch(
    "/",
    wrap(async (req, res) => {
      if (!req.workspaceId) {
        res.status(403).json({ error: "no_workspace" });
        return;
      }
      const parsed = RenameBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const workspace = await deps.renameWorkspace(req.workspaceId, parsed.data.name);
      if (!workspace) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(200).json(workspace);
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}