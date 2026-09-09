// Semantic deduplication — merges signals describing the same event into a cluster via
// Pinecone similarity. This is the one place in the codebase that embeds a signal and
// upserts it into Pinecone (signalsTable's own schema comment: "the signal's own id
// doubles as its Pinecone vector id" — this is where that happens, once, per signal).
// Part 8 (retrieval) only ever queries this index, never writes to it. Terminal pipeline
// stage — no further enqueue after this.
import type { Job } from "bullmq";
import { embedText } from "../lib/embeddings";
import { pineconeQuery, pineconeUpsert } from "../vector/pinecone";
import { logger } from "../lib/logger";
import { registerWorker } from "../queues/registry";
import {
  getSignalById,
  updateSignalCluster,
  createSignalCluster,
  mergeSignalIntoCluster,
  type Signal,
} from "../db/queries";

// Binding threshold from signal_clusters' own schema comment (db/schema.ts) — not a
// suggestion, keep in sync with that comment if this ever changes.
export const DUPLICATE_THRESHOLD = 0.88;

// Small on purpose — we only need the single best match above threshold, not a broad
// candidate set. The signal was just upserted above, so its self-match (score 1.0)
// occupies one of these slots; 5 leaves room for a handful of real candidates too.
export const DEDUP_TOP_K = 5;

// canonical_summary is a display field, not a full copy of the record — cap it so a
// cluster row can't balloon off one long raw_text.
export const CANONICAL_SUMMARY_MAX_LENGTH = 500;

export function buildEmbeddingText(signal: Pick<Signal, "title" | "raw_text">): string {
  return signal.title ? `${signal.title}\n\n${signal.raw_text}` : signal.raw_text;
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

interface DeduplicationJobData {
  signal_id: string;
}

export async function deduplicatorProcessor(job: Job<DeduplicationJobData>): Promise<void> {
  const signal = await getSignalById(job.data.signal_id);
  if (!signal) {
    logger.warn("deduplicator: signal not found — skipping", {
      signal_id: job.data.signal_id,
    });
    return;
  }

  const embedding = await embedText(buildEmbeddingText(signal));

  // The one-time embed+index write this signal will ever get.
  await pineconeUpsert(signal.competitor_id, [
    { id: signal.id, values: embedding, metadata: { source: signal.source } },
  ]);

  const matches = await pineconeQuery(signal.competitor_id, embedding, DEDUP_TOP_K);
  const bestMatch = matches
    .filter((match) => match.id !== signal.id && match.score >= DUPLICATE_THRESHOLD)
    .sort((a, b) => b.score - a.score)[0];

  if (!bestMatch) {
    // No near-duplicate — leave cluster_id null. No cluster row for a singleton signal
    // (signal_clusters only exists for actual multi-signal groups, per its header comment).
    return;
  }

  const matchedSignal = await getSignalById(bestMatch.id);
  if (!matchedSignal) {
    logger.warn("deduplicator: matched signal id not found in db — skipping merge", {
      signal_id: signal.id,
      matched_id: bestMatch.id,
    });
    return;
  }

  if (matchedSignal.cluster_id) {
    await mergeSignalIntoCluster(matchedSignal.cluster_id, signal.source);
    await updateSignalCluster(signal.id, matchedSignal.cluster_id);
    return;
  }

  // First duplicate pair — create the cluster seeded by the matched signal's own source,
  // then merge the new signal's source in via the same "append if not already present"
  // logic used for every later join (mergeSignalIntoCluster also bumps corroboration_count
  // from its default of 1 to 2, correctly reflecting that two signals now contribute).
  const cluster = await createSignalCluster({
    competitor_id: signal.competitor_id,
    canonical_summary: truncate(matchedSignal.raw_text, CANONICAL_SUMMARY_MAX_LENGTH),
    contributing_sources: [matchedSignal.source],
  });
  await mergeSignalIntoCluster(cluster.id, signal.source);
  await updateSignalCluster(matchedSignal.id, cluster.id);
  await updateSignalCluster(signal.id, cluster.id);
}

// Extension point — must only be called from the standalone worker process
// entrypoint, same as every collector's initXWorker(). Not called here so
// importing this module never starts a live Worker as a side effect.
export function initDeduplicatorWorker() {
  return registerWorker("pipeline-deduplication", deduplicatorProcessor);
}
