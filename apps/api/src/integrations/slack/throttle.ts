// Throttle on work any member of a connected Slack team can trigger: agent
// runs (mentions, DMs, /signal ask) and intel writes. Per user and per team,
// so one noisy user can't exhaust the team and one team can't run unbounded.
// Fails open on a Redis error: the per-workspace budgets downstream still hold.
import { cacheRedis } from "../../lib/redis-client";
import { logger } from "../../lib/logger";
import { hitFixedWindow } from "../../mcp/rate-limit";

const WINDOW_SECONDS = 3_600;
export const SLACK_LIMITS = {
  ask: { perUser: 20, perTeam: 100 },
  intel: { perUser: 20, perTeam: 60 },
} as const;

type Hit = (
  key: string,
  limit: number,
  windowSeconds: number,
) => Promise<{ allowed: boolean }>;

export function createSlackThrottle(
  hit: Hit = (key, limit, window) =>
    hitFixedWindow(cacheRedis, key, limit, window),
) {
  return async (
    kind: keyof typeof SLACK_LIMITS,
    teamId: string,
    userId: string,
  ): Promise<boolean> => {
    const limits = SLACK_LIMITS[kind];
    try {
      const [user, team] = await Promise.all([
        hit(
          `slack:${kind}:user:${teamId}:${userId}`,
          limits.perUser,
          WINDOW_SECONDS,
        ),
        hit(`slack:${kind}:team:${teamId}`, limits.perTeam, WINDOW_SECONDS),
      ]);
      return user.allowed && team.allowed;
    } catch (error) {
      logger.warn("slack: throttle unavailable — allowing", {
        team_id: teamId,
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  };
}
