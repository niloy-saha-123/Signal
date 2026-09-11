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
// All other queues (5 collectors, 3 pipeline stages, analysis): concurrency 2,
// 3 attempts with exponential backoff from 5s. Inferred, not stub-sourced —
// no per-queue spec exists for these yet.
import { Queue, Worker, type ConnectionOptions, type Job, type Processor } from "bullmq";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { cacheRedis, redis } from "../lib/redis-client";
import { db } from "../db/client";
import { competitorsTable, competitorDiscoveryLogTable } from "../db/schema";
import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { logger } from "../lib/logger";
import { withRetry } from "../lib/retry";
import {
  createAgentRun,
  failRunIfRunning,
  finalizeDiscovery,
  getCompetitorById,
  getRecentPricingDiffs,
  listCompetitors,
  updateDiscoveryStatus,
} from "../db/queries";
import { discoverCompetitor } from "../agents/discovery/competitor-discovery";

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
  | "analysis";

export interface QueueConfig {
  concurrency: number;
  attempts: number;
  backoff?: { type: "fixed" | "exponential"; delay: number };
  lockDuration?: number;
  limiter?: { max: number; duration: number };
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
  analysis: DEFAULT_CONFIG,
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
  // worker so all 11 queues get it and no future worker has to remember. Fires on
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
  await finalizeDiscovery(competitor_id, result);

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
}

const CompanyProfileUpdateJobDataSchema = z.object({}).strict();
type CompanyProfileUpdateJobData = z.infer<typeof CompanyProfileUpdateJobDataSchema>;

async function companyProfileUpdateProcessor(
  _job: Job<CompanyProfileUpdateJobData>
): Promise<void> {
  CompanyProfileUpdateJobDataSchema.parse(_job.data);
  // The API already attempts this after the DB write. Repeat it at the worker
  // boundary so a transient API-side cache failure cannot make the queued
  // analyses read stale company context.
  await cacheRedis.del("company:profile");

  // Bounded by the active competitor set, which is admin-controlled and small
  // in Phase 0. This never replays historical runs or signals.
  const activeCompetitors = (await listCompetitors()).filter(
    (competitor) => competitor.is_active
  );
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

// Constructs the live BullMQ Workers for competitor-discovery and
// company-profile-update. Must only be called from the standalone worker
// process — never from Express, which imports this module (for `queues`,
// to enqueue jobs) without wanting to also start Redis-polling Workers as a
// side effect of that import. Callers own calling this exactly once.
export function initWorkers(): {
  competitorDiscoveryWorker: Worker;
  companyProfileUpdateWorker: Worker;
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

  return { competitorDiscoveryWorker, companyProfileUpdateWorker };
}
