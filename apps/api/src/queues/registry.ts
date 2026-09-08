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
import { redis } from "../lib/redis-client";
import { db } from "../db/client";
import { competitorsTable, competitorDiscoveryLogTable } from "../db/schema";
import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { logger } from "../lib/logger";

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
}

const DEFAULT_CONFIG: QueueConfig = {
  concurrency: 2,
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
};

export const QUEUE_CONFIG: Record<QueueName, QueueConfig> = {
  "competitor-discovery": { concurrency: 3, attempts: 2, backoff: { type: "fixed", delay: 5000 } },
  "company-profile-update": { concurrency: 1, attempts: 1 },
  "collect-reddit": DEFAULT_CONFIG,
  "collect-hn": DEFAULT_CONFIG,
  "collect-jobs": DEFAULT_CONFIG,
  "collect-changelog": DEFAULT_CONFIG,
  "collect-pricing": DEFAULT_CONFIG,
  "pipeline-entity-extraction": DEFAULT_CONFIG,
  "pipeline-quality-scoring": DEFAULT_CONFIG,
  "pipeline-deduplication": DEFAULT_CONFIG,
  analysis: DEFAULT_CONFIG,
};

export const queues = Object.fromEntries(
  (Object.keys(QUEUE_CONFIG) as QueueName[]).map((name) => [
    name,
    new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: QUEUE_CONFIG[name].attempts,
        backoff: QUEUE_CONFIG[name].backoff,
      },
    }),
  ])
) as Record<QueueName, Queue>;

const registeredWorkers = new Set<string>();

// Extension point — later parts (6, 7, 10, 11) call this once their processor
// logic exists, to attach a real Worker for competitor-discovery /
// company-profile-update / the collectors / pipeline stages. Not called here.
export function registerWorker(queueName: string, processor: Processor): Worker {
  if (registeredWorkers.has(queueName)) {
    throw new Error(`Worker already registered for queue "${queueName}"`);
  }
  const config = (QUEUE_CONFIG as Record<string, QueueConfig>)[queueName];
  if (!config) {
    throw new Error(`No queue config for "${queueName}"`);
  }
  registeredWorkers.add(queueName);

  return new Worker(queueName, processor, {
    connection,
    concurrency: config.concurrency,
  });
}

// Reusable across queues whose real processing logic hasn't landed yet
// (Task 3 also throws this) — distinct from a transient failure so the
// circuit breaker / logs read "not built" rather than "broken".
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

interface CompetitorDiscoveryJobData {
  competitor_id: string;
  name: string;
  domain: string;
}

// CompetitorDiscoveryAgent doesn't exist yet — swap this body out once Part 11 lands,
// the circuit-breaker/failure-logging wrapper below doesn't need to change.
async function runDiscovery(_job: Job<CompetitorDiscoveryJobData>): Promise<void> {
  throw new NotImplementedError("CompetitorDiscoveryAgent is not implemented yet (Part 11)");
}

async function competitorDiscoveryProcessor(job: Job<CompetitorDiscoveryJobData>): Promise<void> {
  if (await isCircuitOpen("competitor-discovery")) {
    throw new Error("competitor-discovery circuit is open — skipping job");
  }
  try {
    await runDiscovery(job);
    await recordSuccess("competitor-discovery");
  } catch (err) {
    await recordFailure("competitor-discovery", err instanceof Error ? err.message : String(err));
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

export const competitorDiscoveryWorker = registerWorker(
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

  void writeDiscoveryFailure(job.data.competitor_id, err).catch((writeErr) => {
    logger.error("Failed to record competitor-discovery terminal failure", {
      competitor_id: job.data.competitor_id,
      error: writeErr,
    });
  });
});

interface CompanyProfileUpdateJobData {
  // Job data type — no fields needed until Part 10 implements the actual logic
}

async function companyProfileUpdateProcessor(
  _job: Job<CompanyProfileUpdateJobData>
): Promise<void> {
  throw new NotImplementedError(
    "Company profile update re-analysis logic is not implemented yet (Part 10)"
  );
}

export const companyProfileUpdateWorker = registerWorker(
  "company-profile-update",
  companyProfileUpdateProcessor
);
