// Weekly Slack digest coordinator. One repeat job fans out over every
// installation that has a channel. A quiet week posts nothing — an empty digest
// trains people to ignore the channel. Each workspace is isolated: one removed
// bot or dead channel must not cost every other team its digest.
import type { Job } from "bullmq";
import {
  getWeeklyDigest,
  listSlackInstallationsWithChannel,
  type WeeklyDigest,
} from "../../db/queries";
import { registerWorker } from "../../queues/registry";
import { cacheRedis } from "../../lib/redis-client";
import { logger } from "../../lib/logger";
import { postMessage } from "./client";
import { digestBlocks } from "./blocks";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_TTL_SECONDS = 8 * 24 * 3600;

export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const claimKey = (workspaceId: string, week: string) =>
  `slack:digest:${workspaceId}:${week}`;

export interface SlackDigestDeps {
  listInstallations: typeof listSlackInstallationsWithChannel;
  getWeeklyDigest: typeof getWeeklyDigest;
  postMessage: typeof postMessage;
  // Per-workspace, per-week send claim so a retried job skips workspaces that
  // already got their digest.
  claimDigestSend: (workspaceId: string, week: string) => Promise<boolean>;
  releaseDigestSend: (workspaceId: string, week: string) => Promise<void>;
  appUrl: string;
  now: () => Date;
}

const defaultDeps: SlackDigestDeps = {
  listInstallations: listSlackInstallationsWithChannel,
  getWeeklyDigest,
  postMessage,
  claimDigestSend: async (workspaceId, week) =>
    (await cacheRedis.set(claimKey(workspaceId, week), "1", "EX", CLAIM_TTL_SECONDS, "NX")) === "OK",
  releaseDigestSend: async (workspaceId, week) => {
    await cacheRedis.del(claimKey(workspaceId, week));
  },
  appUrl: process.env.FRONTEND_URL ?? "http://localhost:3001",
  now: () => new Date(),
};

export function isQuietWeek(digest: WeeklyDigest): boolean {
  return (
    digest.alert_count === 0 &&
    digest.new_forecast_count === 0 &&
    digest.settled.length === 0
  );
}

export async function runSlackDigest(
  deps: SlackDigestDeps = defaultDeps,
): Promise<void> {
  const installations = await deps.listInstallations();
  const since = new Date(deps.now().getTime() - WEEK_MS);
  const week = isoWeek(deps.now());
  let failed = 0;

  for (const installation of installations) {
    if (!installation.default_channel) continue;
    let claimed = false;
    try {
      const digest = await deps.getWeeklyDigest(
        installation.workspace_id,
        since,
      );
      if (isQuietWeek(digest)) continue;
      if (!(await deps.claimDigestSend(installation.workspace_id, week))) continue;
      claimed = true;
      const { blocks, fallbackText } = digestBlocks(digest, deps.appUrl);
      await deps.postMessage({
        token: installation.bot_token,
        channel: installation.default_channel,
        blocks,
        fallbackText,
      });
    } catch (error) {
      if (claimed) {
        await deps.releaseDigestSend(installation.workspace_id, week).catch(() => {});
      }
      failed += 1;
      logger.error(
        "slack: weekly digest failed for one workspace — continuing",
        {
          workspace_id: installation.workspace_id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  if (failed > 0) {
    throw new Error(
      `slack-digest: failed for ${failed} of ${installations.length} workspaces`,
    );
  }
}

export async function slackDigestProcessor(_job: Job): Promise<void> {
  await runSlackDigest();
}

export function initSlackDigestWorker() {
  return registerWorker("slack-digest", slackDigestProcessor);
}
