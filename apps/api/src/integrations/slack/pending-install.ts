// OAuth results parked between the public callback and the signed-in confirm.
// Single use (GETDEL) and short-lived; holds a bot token, so it never outlives
// the state that authorized it.
import { randomBytes } from "node:crypto";
import { cacheRedis } from "../../lib/redis-client";
import type { SlackOAuthResult } from "./oauth";

export const PENDING_INSTALL_TTL_SECONDS = 600;

export interface PendingSlackInstall {
  workspace_id: string;
  user_id: string;
  result: SlackOAuthResult;
}

function key(id: string): string {
  return `slack:pending-install:${id}`;
}

export async function savePendingInstall(
  pending: PendingSlackInstall,
): Promise<string> {
  const id = randomBytes(24).toString("base64url");
  await cacheRedis.set(
    key(id),
    JSON.stringify(pending),
    "EX",
    PENDING_INSTALL_TTL_SECONDS,
  );
  return id;
}

export async function takePendingInstall(
  id: string,
): Promise<PendingSlackInstall | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(id)) return null;
  const raw = await cacheRedis.getdel(key(id));
  return raw ? (JSON.parse(raw) as PendingSlackInstall) : null;
}
