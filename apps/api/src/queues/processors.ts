// Queue name to job handler registry connecting BullMQ workers to collectors, pipelines, and the analysis graph.
import type { Job } from "bullmq";
import { collectRedditSignals } from "../collectors/reddit.js";
import { collectHNSignals } from "../collectors/hn.js";
import { collectJobPostings } from "../collectors/jobs.js";
import { collectChangelogEntries } from "../collectors/changelog.js";
import { watchPricingPage } from "../collectors/pricing.js";
import { embedAndUpsertSignal } from "../pipelines/embedding.js";
import { runAnalysisGraph } from "../graph/analysis-graph.js";

type JobHandler = (job: Job) => Promise<void>;

export const processors: Record<string, JobHandler> = {
  reddit: async (job) => collectRedditSignals(job.data.competitorId),
  hn: async (job) => collectHNSignals(job.data.competitorId),
  jobs: async (job) => collectJobPostings(job.data.competitorId),
  changelog: async (job) => collectChangelogEntries(job.data.competitorId),
  pricing: async (job) => watchPricingPage(job.data.competitorId),
  embedding: async (job) =>
    embedAndUpsertSignal(job.data.competitorId, job.data.signalId, job.data.content),
  analysis: async (job) => {
    await runAnalysisGraph(job.data.competitorId);
  },
};
