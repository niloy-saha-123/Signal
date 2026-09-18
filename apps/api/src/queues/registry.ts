// Defines all BullMQ Queue instances, their retry/concurrency config, and the
// registerWorker extension point that later parts use to attach real processors.
//
// Queue: competitor-discovery
//   Purpose: runs CompetitorDiscoveryAgent for a newly added competitor.
//   Triggered by: POST /api/competitors
//   Concurrency: 3 — safe to discover several competitors at once, each job
//     only makes independent outbound HTTP calls, no shared state to race on.
//   Retry: 2 attempts, 5s delay — network failures should retry; a
//     persistent failure is logged to competitor_discovery_log and the
//     competitor's discovery_status is set to 'failed' rather than retried forever.
//   No rate limiting — discovery runs once per competitor, not on a
//     recurring schedule, so there's no sustained request volume to cap.
//
// Queue: company-profile-update
//   Purpose: when the company profile changes, re-run any pending analyses
//     so their output reflects the new product/ICP/pricing context.
//   Triggered by: POST /api/company-profile
//   Concurrency: 1 — this is a low-frequency, low-volume signal; no need
//     to parallelize.
//   No retry — a missed re-run just means agents use slightly stale
//     context until the next scheduled analysis, not a correctness bug.
//
// All other queues (5 collectors, 3 pipeline stages, pipeline recovery, analysis): concurrency 2,
// 3 attempts with exponential backoff from 5s. Inferred, not stub-sourced —
// no per-queue spec exists for these yet. Recovery is the exception at
// concurrency 1 because every pass is a bounded serial reconciler.
import { Queue, Worker, type ConnectionOptions, type Job, type Processor } from "bullmq";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { redis } from "../lib/redis-client";
import { invalidateCompanyContextCache } from "../lib/company-context";
import { db } from "../db/client";
import { competitorsTable, competitorDiscoveryLogTable } from "../db/schema";
import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { logger } from "../lib/logger";
import { withRetry } from "../lib/retry";
import {
  createAgentRun,
  createOwnCompanyCompetitorRow,
  failRunIfRunning,
  finalizeDiscovery,
  getCompetitorById,
  getRecentPricingDiffs,
  listActiveCompetitors,
  listCompetitorsForWorkspace,
  listWorkspaces,
  getOwnCompanyCompetitorForWorkspace,
  updateDiscoveryStatus,
} from "../db/queries";
import { discoverCompetitor } from "../agents/discovery/competitor-discovery";
import { publishSocketEvent } from "../lib/socket-relay";

// bullmq pins its own ioredis@5 copy while apps/api installs ioredis@^6, so
// npm hoists two separate copies — same runtime API (bullmq duck-types via
// connect/disconnect/duplicate, no `instanceof` check), but TS sees two
// nominally distinct `Redis` classes. Cast at this one boundary rather than
// pulling apps/api's ioredis version down to match bullmq's.
export const connection = redis as unknown as ConnectionOptions;

export type QueueName =
  | "competitor-discovery"
  | "company-profile-update"
  | "collect-reddit"
  | "collect-hn"
  | "collect-jobs"
  | "collect-changelog"
  | "collect-pricing"
  | "pipeline-entity-extraction"
  | "pipeline-quality-scoring"
  | "pipeline-deduplication"
  | "pipeline-recovery"
  | "analysis"
  | "discovery-search"
  | "own-company-analysis-sweep"
  | "daily-analysis-sweep"
  | "pending-confirmation-expiry";

export interface QueueConfig {
  concurrency: number;
  attempts: number;
  backoff?: { type: "fixed" | "exponential"; delay: number };
  lockDuration?: number;
  limiter?: { max: number; duration: number };
}

type StableJobState =
  | "completed"
  | "failed"
  | "active"
  | "delayed"
  | "prioritized"
  | "waiting"
  | "waiting-children"
  | "unknown";

export interface StableJobQueue {
  getJob(jobId: string): Promise<
    | undefined
    | {
        getState(): Promise<string>;
        retry(
          state: "failed" | "completed",
          options: { resetAttemptsMade: boolean; resetAttemptsStarted: boolean }
        ): Promise<void>;
      }
  >;
  add(name: string, data: unknown, options: { jobId: string }): Promise<unknown>;
}

export interface EnsureStableJobInput {
  name: string;
  data: unknown;
  jobId: string;
  repairCompleted?: boolean;
}

export type EnsureStableJobResult = "added" | "existing" | "retried";

const HEALTHY_JOB_STATES = new Set<StableJobState>([
  "active",
  "delayed",
  "prioritized",
  "waiting",
  "waiting-children",
]);

const RETRY_OPTIONS = {
  resetAttemptsMade: true,
  resetAttemptsStarted: true,
} as const;

export async function ensureStableJob(
  queue: StableJobQueue,
  input: EnsureStableJobInput
): Promise<EnsureStableJobResult> {
  const job = await queue.getJob(input.jobId);
  if (!job) {
    await queue.add(input.name, input.data, { jobId: input.jobId });
    return "added";
  }

  const state = await job.getState();
  if (state === "unknown") {
    await queue.add(input.name, input.data, { jobId: input.jobId });
    return "added";
  }
  if (HEALTHY_JOB_STATES.has(state as StableJobState)) return "existing";
  if (state === "completed" && !input.repairCompleted) return "existing";
  if (state === "failed" || state === "completed") {
    await job.retry(state, RETRY_OPTIONS);
    return "retried";
  }
  throw new Error(`Unexpected BullMQ job state "${state}" for job "${input.jobId}"`);
}

const DEFAULT_CONFIG: QueueConfig = {
  concurrency: 2,
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
};

export const COLLECTOR_RATE_LIMITER = { max: 10, duration: 60_000 } as const;
const COLLECTOR_CONFIG: QueueConfig = {
  ...DEFAULT_CONFIG,
  limiter: COLLECTOR_RATE_LIMITER,
};

export const QUEUE_CONFIG: Record<QueueName, QueueConfig> = {
  "competitor-discovery": {
    concurrency: 3,
    attempts: 2,
    backoff: { type: "fixed", delay: 5000 },
    // discoverCompetitor enforces a 45s run deadline on all its probes, so the
    // lock only has to cover that plus finalization — keep the two in step.
    lockDuration: 60_000,
  },
  "company-profile-update": { concurrency: 1, attempts: 1 },
  "collect-reddit": COLLECTOR_CONFIG,
  "collect-hn": COLLECTOR_CONFIG,
  "collect-jobs": COLLECTOR_CONFIG,
  "collect-changelog": COLLECTOR_CONFIG,
  "collect-pricing": COLLECTOR_CONFIG,
  "pipeline-entity-extraction": DEFAULT_CONFIG,
  "pipeline-quality-scoring": DEFAULT_CONFIG,
  "pipeline-deduplication": DEFAULT_CONFIG,
  "pipeline-recovery": { ...DEFAULT_CONFIG, concurrency: 1 },
  analysis: DEFAULT_CONFIG,
  // One discovery sweep at a time is enough — this is not latency-sensitive,
  // and each sweep holds the workspace's thread_id checkpoint while it runs.
  "discovery-search": { concurrency: 1, attempts: 1 },
  // Weekly scheduler-driven fan-out: lists every workspace and enqueues one
  // analysis job per own-company row. One sweep at a time; no retry (a missed
  // sweep is corrected by next week's tick, not a correctness bug).
  // ponytail: attempts:1 is the idempotency ceiling — a future attempts > 1 (or
  // a manual re-trigger) would re-enqueue already-succeeded workspaces and
  // double-bill their LLM runs; a per-week dedup key is the upgrade path.
  "own-company-analysis-sweep": { concurrency: 1, attempts: 1 },
  // Daily scheduler-driven fan-out: lists every active competitor across all
  // workspaces and enqueues one normal `analysis` job per competitor. One sweep
  // at a time; no retry (a missed sweep is corrected by the next day's tick).
  // ponytail: attempts:1 is the idempotency ceiling — a future attempts > 1 (or
  // a manual re-trigger) would re-enqueue already-succeeded competitors and
  // double-bill their LLM runs; a per-day dedup key is the upgrade path.
  "daily-analysis-sweep": { concurrency: 1, attempts: 1 },
  // Scheduled sweep that auto-denies chat confirmations older than the TTL.
  // One at a time; no retry (a missed tick is corrected by the next one, and a
  // double-run would just re-check the same threads idempotently).
  "pending-confirmation-expiry": { concurrency: 1, attempts: 1 },
};

// Inferred, not stub-sourced — no per-queue retention spec exists yet. Bounds
// completed/failed job retention so Redis doesn't grow unboundedly once real
// job volume starts; BullMQ's own default is to keep everything forever.
const JOB_RETENTION = {
  removeOnComplete: { count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

export const queues = Object.fromEntries(
  (Object.keys(QUEUE_CONFIG) as QueueName[]).map((name) => [
    name,
    new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: QUEUE_CONFIG[name].attempts,
        backoff: QUEUE_CONFIG[name].backoff,
        ...JOB_RETENTION,
      },
    }),
  ])
) as Record<QueueName, Queue>;

const registeredWorkers = new Set<string>();

// Extension point — later parts (6, 7, 10, 11) call this once their processor
// logic exists, to attach a real Worker for competitor-discovery /
// company-profile-update / the collectors / pipeline stages. Not called here.
export function registerWorker(queueName: QueueName, processor: Processor): Worker {
  if (registeredWorkers.has(queueName)) {
    throw new Error(`Worker already registered for queue "${queueName}"`);
  }
  const config = (QUEUE_CONFIG as Record<string, QueueConfig>)[queueName];
  if (!config) {
    throw new Error(`No queue config for "${queueName}"`);
  }
  registeredWorkers.add(queueName);

  const worker = new Worker(queueName, processor, {
    connection,
    concurrency: config.concurrency,
    ...(config.lockDuration === undefined ? {} : { lockDuration: config.lockDuration }),
    ...(config.limiter === undefined ? {} : { limiter: config.limiter }),
  });

  // Without this a failed job lands in Redis's failed-job hash and nowhere else,
  // which makes a stuck signal undebuggable from logs. Wired here rather than per
  // worker so all 12 queues get it and no future worker has to remember. Fires on
  // every attempt, including retryable ones — attempts_made/attempts_allowed tell
  // them apart. Additional per-queue 'failed' listeners (competitor-discovery has
  // one) still run; EventEmitter allows many.
  worker.on("failed", (job, err) => {
    logger.error(`Job failed on queue "${queueName}"`, {
      queue: queueName,
      job_id: job?.id,
      job_data: job?.data,
      attempts_made: job?.attemptsMade,
      attempts_allowed: job?.opts?.attempts ?? 1,
      error: err?.message,
      stack: err?.stack,
    });
  });

  return worker;
}

const CompetitorDiscoveryJobDataSchema = z
  .object({
    competitor_id: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    domain: z.string().trim().min(1).max(253),
  })
  .strict();
type CompetitorDiscoveryJobData = z.infer<typeof CompetitorDiscoveryJobDataSchema>;

// Keep discovery orchestration here, inside the standalone worker boundary:
// Express only enqueues the immutable job payload and never performs probes.
async function runDiscovery(job: Job<CompetitorDiscoveryJobData>): Promise<void> {
  const { competitor_id, name, domain } = CompetitorDiscoveryJobDataSchema.parse(job.data);
  const competitor = await getCompetitorById(competitor_id);
  if (!competitor) {
    throw new Error(`competitor ${competitor_id} not found`);
  }

  // A retry after finalizeDiscovery already committed (Redis blip on the
  // circuit-breaker write, SIGKILL before BullMQ's completed-state write) must
  // not re-probe, append a second set of log rows, or flip a terminal status.
  if (competitor.discovery_status === "complete" || competitor.discovery_status === "failed") {
    logger.info("competitor-discovery: already finalized, skipping", {
      competitor_id,
      discovery_status: competitor.discovery_status,
    });
    return;
  }

  await updateDiscoveryStatus(competitor_id, "in_progress");
  await publishSocketEvent("discovery:status_changed", {
    competitor_id,
    discovery_status: "in_progress",
  });
  const result = await discoverCompetitor({
    competitor_id,
    name,
    domain,
    existing: {
      subreddits: competitor.subreddits,
      greenhouse_token: competitor.greenhouse_token,
      lever_token: competitor.lever_token,
      pricing_url: competitor.pricing_url,
      changelog_rss: competitor.changelog_rss,
    },
  });
  const discoveryStatus = await finalizeDiscovery(competitor_id, result);
  await publishSocketEvent("discovery:status_changed", {
    competitor_id,
    discovery_status: discoveryStatus,
  });

  if (result.logs.length > 0 && result.logs.every((log) => log.status !== "found")) {
    logger.warn("competitor-discovery: no fields discovered — see competitor_discovery_log", {
      competitor_id,
    });
  }
}

async function competitorDiscoveryProcessor(job: Job<CompetitorDiscoveryJobData>): Promise<void> {
  if (await isCircuitOpen("competitor-discovery")) {
    throw new Error("competitor-discovery circuit is open — skipping job");
  }
  try {
    await runDiscovery(job);
    try {
      await recordSuccess("competitor-discovery");
    } catch (recordErr) {
      // Same unguarded Redis calls as recordFailure — bookkeeping must never
      // fail a job whose real work already committed (that retry is C-1).
      logger.error("Failed to record circuit-breaker success for competitor-discovery", {
        error: recordErr,
      });
    }
  } catch (err) {
    try {
      await recordFailure("competitor-discovery", err instanceof Error ? err.message : String(err));
    } catch (recordErr) {
      // recordFailure makes unguarded Redis calls that can themselves throw — never let
      // that mask the real job error below.
      logger.error("Failed to record circuit-breaker failure for competitor-discovery", {
        error: recordErr,
      });
    }
    throw err;
  }
}

// One row, not one per field — the placeholder never got far enough to
// probe any individual field, so claiming all 5 "errored" would be false.
// 'subreddits' is just the first value the field_name check constraint
// allows; it's a NOT NULL column with no generic "job-level failure"
// sentinel value available. Insert + status flip commit atomically so a
// crash between them can't orphan a log row with discovery_status left
// stale.
async function writeDiscoveryFailure(competitorId: string, err: Error): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(competitorDiscoveryLogTable).values({
      competitor_id: competitorId,
      field_name: "subreddits",
      status: "error",
      error_message: `discovery job failed after exhausting retries: ${err.message}`,
    });
    await tx
      .update(competitorsTable)
      .set({ discovery_status: "failed" })
      .where(eq(competitorsTable.id, competitorId));
  });
  await publishSocketEvent("discovery:status_changed", {
    competitor_id: competitorId,
    discovery_status: "failed",
  });
}

const CompanyProfileUpdateJobDataSchema = z
  .object({ workspace_id: z.string().uuid() })
  .strict();
type CompanyProfileUpdateJobData = z.infer<typeof CompanyProfileUpdateJobDataSchema>;

async function companyProfileUpdateProcessor(
  _job: Job<CompanyProfileUpdateJobData>
): Promise<void> {
  const { workspace_id } = CompanyProfileUpdateJobDataSchema.parse(_job.data);

  // Bounded by the active competitor set for the one workspace whose profile
  // changed, which is admin-controlled and small in Phase 0. This never
  // replays historical runs or signals.
  const activeCompetitors = (await listCompetitorsForWorkspace(workspace_id)).filter(
    (competitor) => competitor.is_active
  );

  // The API already attempts this after the DB write. Repeat it at the worker
  // boundary so a transient API-side cache failure cannot make the queued
  // analyses read stale company context — scoped to the changed workspace.
  await invalidateCompanyContextCache(workspace_id);

  let failed = 0;

  for (const competitor of activeCompetitors) {
    const run = await createAgentRun({
      competitor_id: competitor.id,
      trigger: "scheduled",
    });
    try {
      const hasPricingDiff = (await getRecentPricingDiffs(competitor.id, 7)).length > 0;
      await queues.analysis.add("analysis", {
        competitor_id: competitor.id,
        workspace_id: competitor.workspace_id,
        run_id: run.id,
        has_pricing_diff: hasPricingDiff,
      });
    } catch (error) {
      failed += 1;
      await failRunIfRunning(run.id).catch(() => undefined);
      logger.error("Failed to enqueue profile-triggered analysis", {
        competitor_id: competitor.id,
        run_id: run.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failed > 0) {
    throw new Error(
      `company-profile-update: failed to enqueue ${failed} of ${activeCompetitors.length} analyses`
    );
  }
}

// Weekly coordinator for the own-company analysis sweep. A repeat job on the
// analysis queue is a poison job (it needs per-competitor competitor_id/
// workspace_id/run_id data, but a repeat job carries fixed empty data), so this
// queue fans out over all workspaces and enqueues one normal `analysis` job per
// workspace's own-company row. The analysis work itself reuses the existing
// analysis queue/graph — nothing new there.
async function ownCompanyAnalysisSweepProcessor(_job: Job): Promise<void> {
  const workspaces = await listWorkspaces();

  let failed = 0;

  for (const workspace of workspaces) {
    const own =
      (await getOwnCompanyCompetitorForWorkspace(workspace.id)) ??
      (await createOwnCompanyCompetitorRow(workspace.id));

    let runId: string | undefined;
    try {
      const run = await createAgentRun({
        competitor_id: own.id,
        trigger: "scheduled",
      });
      runId = run.id;
      const hasPricingDiff = (await getRecentPricingDiffs(own.id, 7)).length > 0;
      await queues.analysis.add("analysis", {
        competitor_id: own.id,
        workspace_id: workspace.id,
        run_id: run.id,
        has_pricing_diff: hasPricingDiff,
      });
    } catch (error) {
      failed += 1;
      if (runId) await failRunIfRunning(runId).catch(() => undefined);
      logger.error("Failed to enqueue own-company analysis", {
        competitor_id: own.id,
        run_id: runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failed > 0) {
    throw new Error(`own-company-analysis-sweep: failed to enqueue ${failed} analyses`);
  }
}

// Daily coordinator for the competitor analysis sweep. Mirrors the weekly
// own-company sweep's fan-out but iterates every active competitor (not just
// each workspace's own-company row) so competitors across all workspaces get
// scored daily. Enqueues one normal `analysis` job per competitor; the analysis
// work itself reuses the existing analysis queue/graph — nothing new there.
async function dailyAnalysisSweepProcessor(_job: Job): Promise<void> {
  const competitors = await listActiveCompetitors();

  let failed = 0;

  for (const competitor of competitors) {
    let runId: string | undefined;
    try {
      const run = await createAgentRun({
        competitor_id: competitor.id,
        trigger: "scheduled",
      });
      runId = run.id;
      const hasPricingDiff = (await getRecentPricingDiffs(competitor.id, 7)).length > 0;
      await queues.analysis.add("analysis", {
        competitor_id: competitor.id,
        workspace_id: competitor.workspace_id,
        run_id: run.id,
        has_pricing_diff: hasPricingDiff,
      });
    } catch (error) {
      failed += 1;
      if (runId) await failRunIfRunning(runId).catch(() => undefined);
      logger.error("Failed to enqueue daily analysis", {
        competitor_id: competitor.id,
        run_id: runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failed > 0) {
    throw new Error(`daily-analysis-sweep: failed to enqueue ${failed} analyses`);
  }
}

// Constructs the live BullMQ Workers for competitor-discovery and
// company-profile-update. Must only be called from the standalone worker
// process — never from Express, which imports this module (for `queues`,
// to enqueue jobs) without wanting to also start Redis-polling Workers as a
// side effect of that import. Callers own calling this exactly once.
export function initWorkers(): {
  competitorDiscoveryWorker: Worker;
  companyProfileUpdateWorker: Worker;
  ownCompanyAnalysisSweepWorker: Worker;
  dailyAnalysisSweepWorker: Worker;
} {
  const competitorDiscoveryWorker = registerWorker(
    "competitor-discovery",
    competitorDiscoveryProcessor
  );

  // BullMQ fires 'failed' on every attempt, including ones still eligible for
  // retry — only write the terminal failure once attemptsMade reaches the
  // queue's configured attempts ceiling.
  competitorDiscoveryWorker.on("failed", (job, err) => {
    if (!job) return;
    const attemptsAllowed = job.opts.attempts ?? 1;
    if (job.attemptsMade < attemptsAllowed) return;
    const parsed = CompetitorDiscoveryJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      logger.error("Cannot record terminal discovery failure for malformed job data", {
        job_id: job.id,
        issues: parsed.error.issues,
      });
      return;
    }

    // withRetry: writeDiscoveryFailure's db.transaction can itself fail on a
    // transient Postgres blip — retry a few times before falling back to a
    // logged, silent drop, since this runs inside an event handler with
    // nothing else watching for the loss.
    void withRetry(() => writeDiscoveryFailure(parsed.data.competitor_id, err), {
      maxAttempts: 3,
    }).catch((writeErr) => {
      logger.error("Failed to record competitor-discovery terminal failure", {
        competitor_id: parsed.data.competitor_id,
        error: writeErr,
      });
    });
  });

  const companyProfileUpdateWorker = registerWorker(
    "company-profile-update",
    companyProfileUpdateProcessor
  );

  const ownCompanyAnalysisSweepWorker = registerWorker(
    "own-company-analysis-sweep",
    ownCompanyAnalysisSweepProcessor
  );

  const dailyAnalysisSweepWorker = registerWorker(
    "daily-analysis-sweep",
    dailyAnalysisSweepProcessor
  );

  return {
    competitorDiscoveryWorker,
    companyProfileUpdateWorker,
    ownCompanyAnalysisSweepWorker,
    dailyAnalysisSweepWorker,
  };
}

// Inline payload shape (not imported from discovery-worker.ts) so the registry
// never depends on the worker module — that would close a registry↔worker
// circular-import loop. Express enqueues the immutable workspace_id; the worker
// is the only side that runs the graph.
export function addDiscoveryJob(input: { workspace_id: string }): Promise<unknown> {
  return queues["discovery-search"].add("discovery-search", input);
}
