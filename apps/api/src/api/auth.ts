// Verifies a Supabase-issued JWT independently of Next.js — Express has no
// shared session with the frontend, only the bearer token the frontend
// attaches to every API/Socket.IO request. workspace_id rides in the token
// itself (stamped by the Custom Access Token Hook, migration 0007) so this
// never needs a DB round-trip for the common case; getWorkspaceIdForUser is
// only a fallback for a token issued before the user had a workspace yet.
//
// ponytail: assumes the modern asymmetric (JWKS) signing mode — no live
// Supabase project exists yet to confirm against (that happens at Task 19).
// If a deployed project turns out to be on legacy HS256, swap
// createRemoteJWKSet for jwtVerify(token, encoded SUPABASE_JWT_SECRET).
import { existsSync } from "node:fs";
import path from "node:path";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import * as jose from "jose";
import { getWorkspaceIdForUser } from "../db/queries";
import { logger } from "../lib/logger";

// db/client.ts normally loads the repo-root .env as a side effect of the
// first real import in the process — but a test that mocks @/db/queries (as
// this middleware's own tests do) never runs that import, so this module
// needs the same idempotent load rather than relying on another module's
// import order. loadEnvFile never overwrites an already-set process.env key.
const rootEnvPath = path.resolve(__dirname, "../../../../.env");
if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is required to verify auth tokens");
}

const jwks = jose.createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

export interface VerifiedUser {
  userId: string;
  email: string;
  workspaceId: string | null;
}

export async function verifyAccessToken(token: string): Promise<VerifiedUser> {
  const { payload } = await jose.jwtVerify(token, jwks);
  const userId = payload.sub;
  if (!userId) throw new Error("token missing sub claim");
  const email = typeof payload.email === "string" ? payload.email : "";
  const claimWorkspaceId = typeof payload.workspace_id === "string" ? payload.workspace_id : null;
  const workspaceId = claimWorkspaceId ?? (await getWorkspaceIdForUser(userId));
  return { userId, email, workspaceId };
}

export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  verifyAccessToken(token)
    .then(({ userId, email, workspaceId }) => {
      req.user = { id: userId, email };
      req.workspaceId = workspaceId;
      next();
    })
    .catch((error) => {
      logger.warn("Rejected invalid access token", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(401).json({ error: "unauthorized" });
    });
};
