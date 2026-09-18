// Cron schedule and per-queue rate-limit configuration for BullMQ.
//
// Only the 5 `collect-*` queues plus `pipeline-recovery` run on a schedule —
// competitor-discovery and company-profile-update are triggered by their API
// routes, never cron'd (see registry.ts's queue doc comments). Collector queue
// names are derived from registry.ts's QUEUE_CONFIG keys rather than
// re-declared here, so the two modules can't drift.
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

export const PIPELINE_RECOVERY_CRON = "*/2 * * * *";
export const PIPELINE_RECOVERY_SCHEDULER_ID = "signal-pipeline-recovery-v1";

// Weekly own-company analysis sweep. Day-of-week cron field (standard cron
// supports 0-7 there; 1 = Monday), 00:00 UTC. Chose Monday over Sunday to stay
// clear of weekend deploy/maintenance windows; the exact day is not load-bearing.
export const OWN_COMPANY_ANALYSIS_SWEEP_CRON = "0 0 * * 1";
export const OWN_COMPANY_ANALYSIS_SWEEP_SCHEDULER_ID = "signal:own-company-analysis-sweep:v1";

// Daily pending-confirmation expiry sweep (auto-deny confirmations older than
// the 7-day TTL). Daily is enough — the TTL is in days, sub-day precision is not
// load-bearing.
export const CONFIRMATION_EXPIRY_CRON = "0 0 * * *";
export const CONFIRMATION_EXPIRY_SCHEDULER_ID = "signal:pending-confirmation-expiry:v1";

// Upserts every collector's schedule plus pipeline-recovery's and the weekly
// own-company analysis sweep's — kept in one function because all three are the
// same "idempotent upsertJobScheduler at worker startup" operation, not separate
// concerns.
export async function registerQueueSchedules(
  queueMap: Pick<
    typeof queues,
    | (typeof COLLECTOR_QUEUE_NAMES)[number]
    | "pipeline-recovery"
    | "own-company-analysis-sweep"
    | "pending-confirmation-expiry"
  > = queues
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
  await queueMap["pipeline-recovery"].upsertJobScheduler(
    PIPELINE_RECOVERY_SCHEDULER_ID,
    { pattern: PIPELINE_RECOVERY_CRON },
    { name: "pipeline-recovery", data: {} }
  );
  // Weekly own-company analysis sweep — a coordinator queue whose processor
  // lists workspaces and enqueues one normal `analysis` job per own-company row.
  // The repeat job carries no data; the coordinator derives per-workspace fan-out
  // at runtime (see registry.ts's ownCompanyAnalysisSweepProcessor).
  await queueMap["own-company-analysis-sweep"].upsertJobScheduler(
    OWN_COMPANY_ANALYSIS_SWEEP_SCHEDULER_ID,
    { pattern: OWN_COMPANY_ANALYSIS_SWEEP_CRON },
    { name: "own-company-analysis-sweep", data: {} }
  );
  // Daily sweep that auto-denies chat confirmations left unresolved past the
  // TTL. The repeat job carries no data; the processor iterates workspaces and
  // resumes each stale thread with a deny (see confirmation-expiry-worker.ts).
  await queueMap["pending-confirmation-expiry"].upsertJobScheduler(
    CONFIRMATION_EXPIRY_SCHEDULER_ID,
    { pattern: CONFIRMATION_EXPIRY_CRON },
    { name: "pending-confirmation-expiry", data: {} }
  );
  // No discovery-search schedule here: a weekly sweep would be a poison job as
  // written (DiscoveryJobDataSchema requires a workspace_id, but a repeat job
  // has no per-workspace fan-out). Before it can be scheduled, this needs to
  // list workspaces and enqueue one discovery-search job per workspace.
}
