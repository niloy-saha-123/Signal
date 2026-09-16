import type { Job, Worker } from "bullmq";
import { z } from "zod";
import {
  discoveryGraph,
  DISCOVERY_RECURSION_LIMIT,
  setupDiscoveryCheckpointer,
} from "./discovery-graph";
import { logger } from "../../lib/logger";
import { registerWorker } from "../../queues/registry";

export const DiscoveryJobDataSchema = z.object({ workspace_id: z.string().uuid() }).strict();
export type DiscoveryJobData = z.infer<typeof DiscoveryJobDataSchema>;

type DiscoverableGraph = Pick<typeof discoveryGraph, "invoke">;

export interface DiscoveryJobProcessorDeps {
  setupCheckpointer?: () => Promise<void>;
}

export function createDiscoveryJobProcessor(
  graph: DiscoverableGraph = discoveryGraph,
  deps: DiscoveryJobProcessorDeps = {}
) {
  const setupCheckpointer = deps.setupCheckpointer ?? setupDiscoveryCheckpointer;
  return async function processDiscoveryJob(job: Job): Promise<void> {
    const parsed = DiscoveryJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      logger.error("Invalid discovery job data", { job_id: job.id, issues: parsed.error.issues });
      throw parsed.error;
    }
    // PostgresSaver does not auto-create its tables, so the checkpointer must be
    // set up before the first invoke on this process — otherwise the
    // checkpoint/interrupt write fails mid-graph.
    await setupCheckpointer();
    await graph.invoke(
      { workspace_id: parsed.data.workspace_id },
      {
        configurable: { thread_id: parsed.data.workspace_id },
        recursionLimit: DISCOVERY_RECURSION_LIMIT,
      }
    );
  };
}

export const discoveryJobProcessor = createDiscoveryJobProcessor();

export function initDiscoveryWorker(): Worker {
  return registerWorker("discovery-search", discoveryJobProcessor);
}