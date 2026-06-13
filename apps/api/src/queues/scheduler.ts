// Cron schedule configuration and per-queue rate limiters for all BullMQ collection jobs.
import { redditQueue, hnQueue, jobsQueue, changelogQueue, pricingQueue, analysisQueue } from "./registry.js";

export async function scheduleCollectionJobs(competitorId: string): Promise<void> {
  const intervalHours = Number(process.env.COLLECT_INTERVAL_HOURS) || 24;
  await redditQueue.add("collect", { competitorId }, { repeat: { every: intervalHours * 60 * 60 * 1000 } });
  await hnQueue.add("collect", { competitorId }, { repeat: { every: intervalHours * 60 * 60 * 1000 } });
  await jobsQueue.add("collect", { competitorId }, { repeat: { every: 24 * 60 * 60 * 1000 } });
  await changelogQueue.add("collect", { competitorId }, { repeat: { every: 12 * 60 * 60 * 1000 } });
  await pricingQueue.add("collect", { competitorId }, { repeat: { every: 48 * 60 * 60 * 1000 } });
  await analysisQueue.add("analyze", { competitorId }, { repeat: { every: 24 * 60 * 60 * 1000 } });
}
