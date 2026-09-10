import type { Job, Worker } from "bullmq";
import { z } from "zod";
import { getCompetitorById, failRunIfRunning } from "../../db/queries";
import { analysisGraph } from "../../graph/analysis-graph";
import { logger } from "../../lib/logger";
import { registerWorker } from "../../queues/registry";

export const AnalysisJobDataSchema = z
  .object({
    competitor_id: z.string().uuid(),
    run_id: z.string().uuid(),
    has_pricing_diff: z.boolean(),
  })
  .strict();

export type AnalysisJobData = z.infer<typeof AnalysisJobDataSchema>;

export const ANALYSIS_TIMEOUT_MS = 120_000;

export class AnalysisTimeoutError extends Error {
  constructor(timeoutMs = ANALYSIS_TIMEOUT_MS) {
    super(`analysis exceeded its ${timeoutMs}ms wall-clock limit`);
    this.name = "AnalysisTimeoutError";
  }
}

async function invokeWithTimeout(data: AnalysisJobData, timeoutMs: number): Promise<void> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => reject(new AnalysisTimeoutError(timeoutMs)), timeoutMs);
    timeoutHandle.unref();
  });

  try {
    // This is a bounded give-up, not cancellation: LangGraph and every nested
    // model SDK do not yet share an AbortSignal. A late synthesis is safe at
    // the storage boundary because run failure is conditional and daily score
    // writes are upserts.
    await Promise.race([
      analysisGraph.invoke({
        competitor_id: data.competitor_id,
        run_id: data.run_id,
        has_pricing_diff: data.has_pricing_diff,
      }),
      timeout,
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export function createAnalysisJobProcessor(timeoutMs = ANALYSIS_TIMEOUT_MS) {
  return async function processAnalysisJob(job: Job): Promise<void> {
    const parsed = AnalysisJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      logger.error("Invalid analysis job data", {
        job_id: job.id,
        issues: parsed.error.issues,
      });
      throw parsed.error;
    }

    const data = parsed.data;
    try {
      const competitor = await getCompetitorById(data.competitor_id);
      if (!competitor) {
        throw new Error(`analysis: competitor ${data.competitor_id} not found`);
      }

      await invokeWithTimeout(data, timeoutMs);
      logger.info("Analysis job completed", {
        job_id: job.id,
        run_id: data.run_id,
        competitor_id: data.competitor_id,
      });
    } catch (error) {
      try {
        await failRunIfRunning(data.run_id);
      } catch (failureWriteError) {
        logger.error("Failed to mark analysis run failed", {
          job_id: job.id,
          run_id: data.run_id,
          error:
            failureWriteError instanceof Error
              ? failureWriteError.message
              : String(failureWriteError),
        });
      }
      throw error;
    }
  };
}

export const analysisJobProcessor = createAnalysisJobProcessor();

export function initAnalysisWorker(): Worker {
  return registerWorker("analysis", analysisJobProcessor);
}
