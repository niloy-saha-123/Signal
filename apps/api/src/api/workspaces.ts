// Onboarding (create a workspace), invite generation, and invite redemption.
// One workspace per user — POST / and POST /join/:token both 409 if the
// caller already has one (req.workspaceId set by requireAuth).
import express, { Router } from "express";
import { z } from "zod";
import * as queries from "../db/queries";
import { wrap, fallbackErrorHandler } from "./http";

export interface WorkspaceRouterDeps {
  createWorkspace: typeof queries.createWorkspace;
  createWorkspaceInvite: typeof queries.createWorkspaceInvite;
  getValidInviteByToken: typeof queries.getValidInviteByToken;
  redeemInvite: typeof queries.redeemInvite;
}

export const defaultWorkspaceRouterDeps: WorkspaceRouterDeps = {
  createWorkspace: queries.createWorkspace,
  createWorkspaceInvite: queries.createWorkspaceInvite,
  getValidInviteByToken: queries.getValidInviteByToken,
  redeemInvite: queries.redeemInvite,
};

const CreateBodySchema = z.object({ name: z.string().min(1).max(200) }).strict();
const INVITE_TTL_HOURS = 168; // 7 days

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

  router.post(
    "/invites",
    wrap(async (req, res) => {
      if (!req.workspaceId) {
        res.status(409).json({ error: "no_workspace" });
        return;
      }
      const invite = await deps.createWorkspaceInvite({
        workspaceId: req.workspaceId,
        createdBy: req.user!.id,
        ttlHours: INVITE_TTL_HOURS,
      });
      res.status(201).json({ token: invite.token, expires_at: invite.expires_at });
    })
  );

  router.post(
    "/join/:token",
    wrap(async (req, res) => {
      if (req.workspaceId) {
        res.status(409).json({ error: "already_has_workspace" });
        return;
      }
      const invite = await deps.getValidInviteByToken(req.params.token);
      if (!invite) {
        res.status(404).json({ error: "invalid_or_expired_invite" });
        return;
      }
      await deps.redeemInvite({ inviteId: invite.id, userId: req.user!.id });
      res.status(200).json({ workspace_id: invite.workspace_id });
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
