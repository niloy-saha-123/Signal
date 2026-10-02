// Signed-in side of the Slack integration: status for Settings, the "Add to
// Slack" URL (state minted here, where the user's workspace is known),
// confirm of a parked install, and disconnect. The OAuth callback itself is
// public and lives in slack.ts.
import express, { Router } from "express";
import {
  deleteSlackInstallationsForWorkspace,
  getSlackInstallationForWorkspace,
  replaceSlackInstallation,
} from "../db/queries";
import {
  buildSlackAuthorizeUrl,
  revokeSlackToken,
  signSlackState,
  slackOAuthConfig,
  type SlackOAuthConfig,
} from "../integrations/slack/oauth";
import { takePendingInstall, type PendingSlackInstall } from "../integrations/slack/pending-install";
import { logger } from "../lib/logger";
import { wrap, fallbackErrorHandler } from "./http";

export interface SlackIntegrationRouterDeps {
  config: () => SlackOAuthConfig | null;
  getSlackInstallationForWorkspace: typeof getSlackInstallationForWorkspace;
  deleteSlackInstallationsForWorkspace: typeof deleteSlackInstallationsForWorkspace;
  revokeToken: (token: string) => Promise<void>;
  takePendingInstall: (id: string) => Promise<PendingSlackInstall | null>;
  replaceSlackInstallation: typeof replaceSlackInstallation;
}

export const defaultSlackIntegrationRouterDeps: SlackIntegrationRouterDeps = {
  config: () => slackOAuthConfig(),
  getSlackInstallationForWorkspace,
  deleteSlackInstallationsForWorkspace,
  revokeToken: revokeSlackToken,
  takePendingInstall,
  replaceSlackInstallation,
};

export function createSlackIntegrationRouter(
  deps: SlackIntegrationRouterDeps = defaultSlackIntegrationRouterDeps
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
      const row = await deps.getSlackInstallationForWorkspace(req.workspaceId!);
      if (!row) {
        res.status(200).json({ connected: false });
        return;
      }
      res.status(200).json({
        connected: true,
        team_name: row.team_name,
        channel_name: row.default_channel_name,
      });
    })
  );

  router.post(
    "/install",
    wrap(async (req, res) => {
      const config = deps.config();
      if (!config) {
        res.status(503).json({ error: "slack_not_configured" });
        return;
      }
      const state = signSlackState(
        { workspace_id: req.workspaceId!, user_id: req.user!.id },
        config.clientSecret
      );
      res.status(200).json({ url: buildSlackAuthorizeUrl(config, state) });
    })
  );

  router.post(
    "/confirm",
    wrap(async (req, res) => {
      const id = typeof req.body?.install_id === "string" ? req.body.install_id : "";
      const pending = id ? await deps.takePendingInstall(id) : null;
      if (!pending) {
        res.status(410).json({ error: "install_expired" });
        return;
      }
      // Consumed above either way, so a mismatched id can't be retried.
      if (pending.workspace_id !== req.workspaceId || pending.user_id !== req.user!.id) {
        res.status(403).json({ error: "install_mismatch" });
        return;
      }
      const { result } = pending;
      const row = await deps.replaceSlackInstallation({
        workspace_id: pending.workspace_id,
        team_id: result.team_id,
        team_name: result.team_name,
        bot_token: result.bot_token,
        bot_user_id: result.bot_user_id,
        default_channel: result.channel_id,
        default_channel_name: result.channel_name,
        installed_by: pending.user_id,
      });
      if (!row) {
        res.status(409).json({ error: "team_in_use" });
        return;
      }
      res
        .status(200)
        .json({ connected: true, team_name: row.team_name, channel_name: row.default_channel_name });
    })
  );

  router.delete(
    "/",
    wrap(async (req, res) => {
      const row = await deps.getSlackInstallationForWorkspace(req.workspaceId!);
      if (row) {
        try {
          await deps.revokeToken(row.bot_token);
        } catch (error) {
          // The row is deleted regardless: once it's gone nothing posts, and a
          // token Slack already considers dead must not block disconnecting.
          logger.warn("slack: token revoke failed on disconnect — deleting anyway", {
            workspace_id: req.workspaceId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await deps.deleteSlackInstallationsForWorkspace(req.workspaceId!);
      res.status(204).end();
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
