import type { Job } from "bullmq";
import { z } from "zod";
import type { SignalPipelineStage } from "../db/schema";
import { listPendingSignalPipelineOutbox } from "../db/queries";
import {
  ensureStableJob,
  queues,
  registerWorker,
  type EnsureStableJobResult,
} from "../queues/registry";
import { logger } from "../lib/logger";

export const PIPELINE_RECOVERY_BATCH_SIZE = 100;

const RecoveryJobDataSchema = z.object({}).strict();

const STAGE_JOB = {
  entity_extraction: {
    queue: "pipeline-entity-extraction",
    name: "extract-entities",
  },
  quality_scoring: {
    queue: "pipeline-quality-scoring",
    name: "score-quality",
  },
  deduplication: {
    queue: "pipeline-deduplication",
    name: "deduplicate",
  },
} as const satisfies Record<SignalPipelineStage, { queue: keyof typeof queues; name: string }>;

export function pipelineJobId(stage: SignalPipelineStage, signalId: string): string {
  return `pipeline-${stage.replaceAll("_", "-")}-${signalId}`;
}

export async function ensureSignalPipelineJob(
  stage: SignalPipelineStage,
  signalId: string,
  options: { repairCompleted?: boolean } = {}
): Promise<EnsureStableJobResult> {
  const config = STAGE_JOB[stage];
  return ensureStableJob(queues[config.queue], {
    name: config.name,
    data: { signal_id: signalId },
    jobId: pipelineJobId(stage, signalId),
    repairCompleted: options.repairCompleted,
  });
}

export async function enqueueInitialSignalPipeline(
  signalId: string
): Promise<EnsureStableJobResult | "deferred"> {
  try {
    return await ensureSignalPipelineJob("entity_extraction", signalId);
  } catch (error) {
    logger.warn("Immediate pipeline enqueue failed; deferred to pipeline outbox", {
      signal_id: signalId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "deferred";
  }
}

export async function pipelineRecoveryProcessor(job: Job<unknown>): Promise<void> {
  RecoveryJobDataSchema.parse(job.data ?? {});
  const rows = await listPendingSignalPipelineOutbox(PIPELINE_RECOVERY_BATCH_SIZE);
  for (const row of rows) {
    await ensureSignalPipelineJob(row.stage, row.signal_id, { repairCompleted: true });
  }
}

export function initPipelineRecoveryWorker() {
  return registerWorker("pipeline-recovery", pipelineRecoveryProcessor);
}
