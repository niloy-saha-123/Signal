// BullMQ worker entry point that dispatches jobs to collectors, pipelines, and analysis agents.
import { Worker } from "bullmq";
import { connection } from "./src/queues/registry.js";
import { processors } from "./src/queues/processors.js";
import { logger } from "./src/lib/logger.js";

for (const [name, handler] of Object.entries(processors)) {
  new Worker(name, handler, { connection });
}

logger.info("BullMQ worker started", { queues: Object.keys(processors) });
