// BullMQ worker process entry point — collection, enrichment, discovery and
// analysis stay outside Express so Playwright/LLM work cannot block HTTP.
import type { Worker } from "bullmq";
import { initWorkers, queues } from "./src/queues/registry";
import { registerCollectorSchedules } from "./src/queues/scheduler";
import { initRedditWorker } from "./src/collectors/reddit";
import { initHnWorker } from "./src/collectors/hn";
import { initJobsWorker } from "./src/collectors/jobs";
import { initChangelogWorker } from "./src/collectors/changelog";
import { initPricingWorker } from "./src/collectors/pricing";
import { initEntityExtractorWorker } from "./src/pipeline/entity-extractor";
import { initQualityScorerWorker } from "./src/pipeline/quality-scorer";
import { initDeduplicatorWorker } from "./src/pipeline/deduplicator";
import { initAnalysisWorker } from "./src/agents/analysis/analysis-worker";
import { closeRedisConnections } from "./src/lib/redis-client";
import { closeDatabase } from "./src/db/client";
import { logger } from "./src/lib/logger";

export interface WorkerEnvironment {
  DATABASE_URL?: string;
  REDIS_URL?: string;
}

export function validateWorkerEnvironment(env: WorkerEnvironment = process.env): void {
  const missing = ["DATABASE_URL", "REDIS_URL"].filter(
    (key) => !env[key as keyof WorkerEnvironment]?.trim()
  );
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

type ClosableWorker = Pick<Worker, "close">;

export interface WorkerRuntimeDeps {
  registerSchedules: () => Promise<void>;
  initAllWorkers: () => ClosableWorker[] | Promise<ClosableWorker[]>;
  closeQueues: () => Promise<void>;
  closeRedis: () => Promise<void>;
  closeDatabase: () => Promise<void>;
}

const defaultDeps: WorkerRuntimeDeps = {
  registerSchedules: registerCollectorSchedules,
  initAllWorkers: async () => {
    const initialized: ClosableWorker[] = [];
    try {
      const registryWorkers = initWorkers();
      initialized.push(
        registryWorkers.competitorDiscoveryWorker,
        registryWorkers.companyProfileUpdateWorker
      );
      for (const initialize of [
        initRedditWorker,
        initHnWorker,
        initJobsWorker,
        initChangelogWorker,
        initPricingWorker,
        initEntityExtractorWorker,
        initQualityScorerWorker,
        initDeduplicatorWorker,
        initAnalysisWorker,
      ]) {
        initialized.push(initialize());
      }
      return initialized;
    } catch (error) {
      // Array literals lose already-created elements if a later constructor
      // throws. Keep the incremental list and close it here so a startup
      // failure cannot strand Redis-backed Worker handles.
      await Promise.allSettled(initialized.map((worker) => worker.close()));
      throw error;
    }
  },
  closeQueues: () =>
    Promise.allSettled(Object.values(queues).map((queue) => queue.close())).then(() => undefined),
  closeRedis: closeRedisConnections,
  closeDatabase,
};

async function attemptAll(operations: Array<() => Promise<unknown>>): Promise<void> {
  const results = await Promise.allSettled(operations.map((operation) => operation()));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) throw new AggregateError(failures, "Worker resource shutdown failed");
}

async function closeWorkerWithDeadline(worker: ClosableWorker): Promise<void> {
  let timedOut = false;
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      resolve();
    }, 30_000);
    timeoutHandle.unref();
  });
  await Promise.race([worker.close(), timeout]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (timedOut) await worker.close(true);
}

export function createWorkerRuntime(deps: WorkerRuntimeDeps = defaultDeps) {
  let workers: ClosableWorker[] = [];
  let started = false;
  let closePromise: Promise<void> | undefined;

  return {
    async start(): Promise<void> {
      if (started) throw new Error("Worker runtime already started");
      await deps.registerSchedules();
      try {
        workers = await deps.initAllWorkers();
        started = true;
        logger.info("Signal worker runtime started", { worker_count: workers.length });
      } catch (error) {
        await attemptAll(workers.map((worker) => () => worker.close())).catch(() => undefined);
        throw error;
      }
    },
    close(): Promise<void> {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        const failures: unknown[] = [];
        for (const phase of [
          workers.map((worker) => () => closeWorkerWithDeadline(worker)),
          [deps.closeQueues],
          [deps.closeRedis, deps.closeDatabase],
        ]) {
          try {
            await attemptAll(phase);
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length > 0) {
          throw new AggregateError(failures, "Worker resource shutdown failed");
        }
      })();
      return closePromise;
    },
  };
}

export async function startWorkerFromEnvironment(env: WorkerEnvironment = process.env) {
  const runtime = createWorkerRuntime();
  try {
    validateWorkerEnvironment(env);
    await runtime.start();
  } catch (error) {
    await runtime.close().catch((shutdownError) => {
      logger.error("Worker cleanup after startup failure failed", { error: shutdownError });
    });
    throw error;
  }

  const shutdown = () => {
    void runtime.close().catch((error) => {
      logger.error("Worker shutdown failed", { error });
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return runtime;
}

if (require.main === module) {
  void startWorkerFromEnvironment().catch(async (error) => {
    logger.error("Worker startup failed", { error });
    process.exitCode = 1;
  });
}
