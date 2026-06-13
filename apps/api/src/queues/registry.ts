// Central registry that instantiates all BullMQ queues and workers for collection and analysis jobs.
import { Queue } from "bullmq";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
  maxRetriesPerRequest: null,
};

export const redditQueue = new Queue("reddit", { connection });
export const hnQueue = new Queue("hn", { connection });
export const jobsQueue = new Queue("jobs", { connection });
export const changelogQueue = new Queue("changelog", { connection });
export const pricingQueue = new Queue("pricing", { connection });
export const embeddingQueue = new Queue("embedding", { connection });
export const analysisQueue = new Queue("analysis", { connection });
export const weeklyDigestQueue = new Queue("weekly-digest", { connection });

export { connection };
