// Bearer auth for /mcp. Separate from requireAuth: MCP clients hold a long-lived
// workspace token (sig_…), not a Supabase session JWT.
import type { RequestHandler } from "express";
import * as queries from "../db/queries";
import { logger } from "../lib/logger";
import { API_TOKEN_PREFIX, hashApiToken } from "./tokens";

export interface ApiTokenAuthDeps {
  findActiveApiTokenByHash: typeof queries.findActiveApiTokenByHash;
  touchApiTokenLastUsed: typeof queries.touchApiTokenLastUsed;
}

export const defaultApiTokenAuthDeps: ApiTokenAuthDeps = {
  findActiveApiTokenByHash: queries.findActiveApiTokenByHash,
  touchApiTokenLastUsed: queries.touchApiTokenLastUsed,
};

// sig_ + 43 base64url chars; anything far off that shape never reaches the DB.
const TOKEN_SHAPE = /^sig_[A-Za-z0-9_-]{20,100}$/;

export function requireApiToken(deps: ApiTokenAuthDeps = defaultApiTokenAuthDeps): RequestHandler {
  return (req, res, next) => {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
    const reject = () => {
      res.setHeader("WWW-Authenticate", 'Bearer realm="signal-mcp"');
      res.status(401).json({ error: "unauthorized" });
    };
    if (!token || !token.startsWith(API_TOKEN_PREFIX) || !TOKEN_SHAPE.test(token)) {
      reject();
      return;
    }
    deps
      .findActiveApiTokenByHash(hashApiToken(token))
      .then((row) => {
        if (!row) {
          reject();
          return;
        }
        req.workspaceId = row.workspace_id;
        req.apiTokenId = row.id;
        deps.touchApiTokenLastUsed(row.id).catch((error) => {
          logger.warn("mcp: failed to record token last_used_at", {
            token_id: row.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        next();
      })
      .catch(next);
  };
}
