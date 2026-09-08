// Cron schedule and per-queue rate-limit configuration for BullMQ.
//
// Only the 5 `collect-*` queues run on a schedule — competitor-discovery
// and company-profile-update are triggered by their API routes, never
// cron'd (see registry.ts's queue doc comments). Collector queue names are
// derived from registry.ts's QUEUE_CONFIG keys rather than re-declared
// here, so the two modules can't drift.
import { QUEUE_CONFIG, type QueueName } from "./registry";

const DEFAULT_COLLECT_INTERVAL_HOURS = 24;

// Inferred, not stub-sourced — no per-collector rate-limit spec exists yet.
const RATE_LIMIT_MAX_JOBS_PER_MINUTE = 10;
const RATE_LIMIT_DURATION_MS = 60_000;

export const COLLECTOR_QUEUE_NAMES: QueueName[] = (Object.keys(QUEUE_CONFIG) as QueueName[]).filter(
  (name) => name.startsWith("collect-")
);

export function getCollectIntervalHours(): number {
  const raw = process.env.COLLECT_INTERVAL_HOURS;
  const parsed = Number(raw ?? DEFAULT_COLLECT_INTERVAL_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COLLECT_INTERVAL_HOURS;
}

// Standard cron hour fields only go 0-23, so `*/N` breaks once N reaches
// 24 — collapse anything a full day or longer to "once daily at midnight"
// instead of emitting an invalid pattern.
export function collectorCronExpression(hours: number = getCollectIntervalHours()): string {
  const wholeHours = Math.max(1, Math.floor(hours));
  if (wholeHours >= 24) return "0 0 * * *";
  if (wholeHours === 1) return "0 * * * *";
  return `0 */${wholeHours} * * *`;
}

export interface CollectorScheduleConfig {
  repeat: { pattern: string };
  limiter: { max: number; duration: number };
}

export function getCollectorScheduleConfig(): Partial<Record<QueueName, CollectorScheduleConfig>> {
  const config: CollectorScheduleConfig = {
    repeat: { pattern: collectorCronExpression() },
    limiter: { max: RATE_LIMIT_MAX_JOBS_PER_MINUTE, duration: RATE_LIMIT_DURATION_MS },
  };
  return Object.fromEntries(COLLECTOR_QUEUE_NAMES.map((name) => [name, config]));
}
