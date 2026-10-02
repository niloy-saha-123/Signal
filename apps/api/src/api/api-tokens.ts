// Settings → MCP access: create, list and revoke workspace API tokens. The
// plaintext token is returned once, on create; only its sha256 is stored.
import express, { Router } from "express";
import { z } from "zod";
import * as queries from "../db/queries";
import { generateApiToken } from "../mcp/tokens";
import { wrap, fallbackErrorHandler, requireUuidParam } from "./http";

export const MAX_ACTIVE_API_TOKENS = 20;

export interface ApiTokenRouterDeps {
  listApiTokens: typeof queries.listApiTokens;
  countActiveApiTokens: typeof queries.countActiveApiTokens;
  createApiToken: typeof queries.createApiToken;
  revokeApiToken: typeof queries.revokeApiToken;
}

export const defaultApiTokenRouterDeps: ApiTokenRouterDeps = {
  listApiTokens: queries.listApiTokens,
  countActiveApiTokens: queries.countActiveApiTokens,
  createApiToken: queries.createApiToken,
  revokeApiToken: queries.revokeApiToken,
};

const CreateBodySchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();

export function createApiTokenRouter(deps: ApiTokenRouterDeps = defaultApiTokenRouterDeps): Router {
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
      res.status(200).json(await deps.listApiTokens(req.workspaceId!));
    })
  );

  router.post(
    "/",
    wrap(async (req, res) => {
      const parsed = CreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      // ponytail: count-then-insert can overshoot the cap under concurrent creates; a
      // per-workspace advisory lock fixes it if the cap ever has to be exact.
      if ((await deps.countActiveApiTokens(req.workspaceId!)) >= MAX_ACTIVE_API_TOKENS) {
        res.status(409).json({ error: "token_limit" });
        return;
      }
      const { token, hash, prefix } = generateApiToken();
      const row = await deps.createApiToken({
        workspace_id: req.workspaceId!,
        created_by: req.user?.id ?? null,
        name: parsed.data.name,
        token_hash: hash,
        prefix,
      });
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json({ ...row, token });
    })
  );

  router.delete(
    "/:id",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (!id) return;
      const row = await deps.revokeApiToken(id, req.workspaceId!);
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(204).end();
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
