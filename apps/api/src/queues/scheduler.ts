// Cron schedule and per-queue rate-limit configuration for BullMQ.
//
// Only the 5 `collect-*` queues run on a schedule — competitor-discovery
// and company-profile-update are triggered by their API routes, never
// cron'd (see registry.ts's queue doc comments). Collector queue names are
// derived from registry.ts's QUEUE_CONFIG keys rather than re-declared
// here, so the two modules can't drift.
import { COLLECTOR_RATE_LIMITER, QUEUE_CONFIG, queues, type QueueName } from "./registry";

const DEFAULT_COLLECT_INTERVAL_HOURS = 24;

// Sourced from each collector's own header-comment spec (collectors/*.ts) —
// not uniform. Falls back to DEFAULT_COLLECT_INTERVAL_HOURS for any
// collect-* queue not listed here.
const COLLECTOR_DEFAULT_HOURS: Partial<Record<QueueName, number>> = {
  "collect-reddit": 6,
  "collect-hn": 6,
  "collect-jobs": 24,
  "collect-changelog": 12,
  "collect-pricing": 48,
};

export const COLLECTOR_QUEUE_NAMES: QueueName[] = (Object.keys(QUEUE_CONFIG) as QueueName[]).filter(
  (name) => name.startsWith("collect-")
);

export function getCollectIntervalHours(): number {
  const raw = process.env.COLLECT_INTERVAL_HOURS;
  const parsed = Number(raw ?? DEFAULT_COLLECT_INTERVAL_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COLLECT_INTERVAL_HOURS;
}

// Only set when COLLECT_INTERVAL_HOURS is present in env AND parses to a
// valid positive number — distinct from getCollectIntervalHours(), which
// always resolves to *some* number (falling back to
// DEFAULT_COLLECT_INTERVAL_HOURS) and so can't be used to detect "was an
// override explicitly requested?".
function getExplicitCollectIntervalHoursOverride(): number | undefined {
  const raw = process.env.COLLECT_INTERVAL_HOURS;
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Standard cron hour fields only go 0-23, so `*/N` breaks once N reaches
// 24 — anything a full day or longer switches to the day-of-month field
// instead. Multi-day intervals that are a whole number of days (48h, 72h,
// ...) use `*/N` there (cron supports step values on day-of-month) so a
// 48h collector doesn't collapse to the same daily pattern as a 24h one.
// A >24h interval that ISN'T a whole number of days (e.g. 30h) can't be
// expressed as a day-of-month step — standard cron has no "every 30 hours"
// field — so that case falls back to daily. None of the 5 stub-sourced
// collector defaults hit this branch today.
export function collectorCronExpression(hours: number = getCollectIntervalHours()): string {
  const wholeHours = Math.max(1, Math.floor(hours));
  if (wholeHours === 1) return "0 * * * *";
  if (wholeHours < 24) return `0 */${wholeHours} * * *`;
  if (wholeHours === 24) return "0 0 * * *";
  if (wholeHours % 24 === 0) return `0 0 */${wholeHours / 24} * *`;
  return "0 0 * * *";
}

export interface CollectorScheduleConfig {
  repeat: { pattern: string };
  limiter: { max: number; duration: number };
}

export function getCollectorScheduleConfig(): Partial<Record<QueueName, CollectorScheduleConfig>> {
  // Explicit env override, when set, wins uniformly over every collector's
  // own default cadence — otherwise each queue keeps its stub-sourced hours.
  const override = getExplicitCollectIntervalHoursOverride();

  return Object.fromEntries(
    COLLECTOR_QUEUE_NAMES.map((name) => {
      const hours = override ?? COLLECTOR_DEFAULT_HOURS[name] ?? DEFAULT_COLLECT_INTERVAL_HOURS;
      const config: CollectorScheduleConfig = {
        repeat: { pattern: collectorCronExpression(hours) },
        limiter: COLLECTOR_RATE_LIMITER,
      };
      return [name, config];
    })
  );
}

// The ID, rather than the delayed job ID BullMQ creates on each tick, is the
// idempotency key. Upserting on every worker startup updates cadence changes
// without accumulating duplicate repeat definitions.
export function collectorSchedulerId(queueName: QueueName): string {
  return `signal:collector:${queueName}:v1`;
}

export async function registerCollectorSchedules(
  queueMap: Pick<typeof queues, (typeof COLLECTOR_QUEUE_NAMES)[number]> = queues
): Promise<void> {
  const config = getCollectorScheduleConfig();
  await Promise.all(
    COLLECTOR_QUEUE_NAMES.map(async (queueName) => {
      const schedule = config[queueName];
      if (!schedule) throw new Error(`Missing collector schedule for ${queueName}`);
      await queueMap[queueName].upsertJobScheduler(
        collectorSchedulerId(queueName),
        schedule.repeat,
        { name: queueName, data: {} }
      );
    })
  );
}
