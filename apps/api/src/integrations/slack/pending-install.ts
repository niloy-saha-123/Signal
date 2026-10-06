// OAuth results parked between the public callback and the signed-in confirm.
// Single use (GETDEL) and short-lived; holds a bot token, so it never outlives
// the state that authorized it.
import { randomBytes } from "node:crypto";
import { cacheRedis } from "../../lib/redis-client";
import type { SlackOAuthResult } from "./oauth";
import { decryptSlackToken, encryptSlackToken } from "./token-crypto";

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
    JSON.stringify({
      ...pending,
      result: { ...pending.result, bot_token: encryptSlackToken(pending.result.bot_token) },
    }),
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
  if (!raw) return null;
  const pending = JSON.parse(raw) as PendingSlackInstall;
  return {
    ...pending,
    result: { ...pending.result, bot_token: decryptSlackToken(pending.result.bot_token) },
  };
}
