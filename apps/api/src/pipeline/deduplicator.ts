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
import { trackLatency } from "../lib/latency-tracker";
import {
  getSignalById,
  createClusterForSignalPair,
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

// text-embedding-3-small hard-caps at 8192 tokens and answers a longer input with a
// non-retryable 400 — which would burn every BullMQ attempt and strand the signal
// unindexed forever. 24k chars is roughly 6k tokens, comfortably under. Reddit
// selftext, changelog RSS bodies and Greenhouse job descriptions all reach this
// length as ordinary (not adversarial) input.
export const EMBEDDING_TEXT_MAX_LENGTH = 24_000;

export function buildEmbeddingText(signal: Pick<Signal, "title" | "raw_text">): string {
  const text = signal.title ? `${signal.title}\n\n${signal.raw_text}` : signal.raw_text;
  return text.slice(0, EMBEDDING_TEXT_MAX_LENGTH);
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

  // Idempotency guard, before any embedding work: this queue runs attempts: 3, and
  // the merge/create writes below are not replay-safe (corroboration_count would
  // double-increment). A cluster_id already set means a previous attempt got all the
  // way through — terminal no-op, and it also skips a pointless re-embed/re-query.
  if (signal.cluster_id) {
    logger.info("deduplicator: signal already clustered by a previous attempt — skipping", {
      signal_id: signal.id,
      cluster_id: signal.cluster_id,
    });
    return;
  }

  const embeddingText = buildEmbeddingText(signal);
  // raw_text is NOT NULL but not non-empty (collectors can write ""), and OpenAI 400s
  // on empty input — the same permanent-failure shape as an over-long input.
  if (!embeddingText.trim()) {
    logger.warn("deduplicator: signal has no embeddable text — skipping", {
      signal_id: signal.id,
    });
    return;
  }

  // job.id is only optional on a not-yet-added Job — matches entity-extractor.ts's
  // same fallback rather than casting.
  const runId = job.id ?? signal.id;

  // The most external I/O of any pipeline stage (one embedding + two Pinecone
  // round-trips) — tracked as one span so it shows up in scripts/latency-report.ts.
  const matches = await trackLatency("deduplicator", signal.competitor_id, runId, async () => {
    const embedding = await embedText(embeddingText);

    // The one-time embed+index write this signal will ever get.
    await pineconeUpsert(signal.competitor_id, [
      { id: signal.id, values: embedding, metadata: { source: signal.source } },
    ]);

    return pineconeQuery(signal.competitor_id, embedding, DEDUP_TOP_K);
  });

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
    // Atomic: the corroboration bump and this signal's cluster_id land together, so a
    // retry can never double-count one signal joining once.
    const cluster = await mergeSignalIntoCluster(
      matchedSignal.cluster_id,
      signal.id,
      signal.source
    );
    logger.info("deduplicator: signal joined an existing cluster", {
      signal_id: signal.id,
      cluster_id: cluster.id,
      corroboration_count: cluster.corroboration_count,
    });
    return;
  }

  // First duplicate pair — one atomic write (see createClusterForSignalPair): the cluster
  // row plus both signals' cluster_id, so a partial failure can't leave an orphaned
  // cluster for a retry to duplicate.
  const cluster = await createClusterForSignalPair({
    competitor_id: signal.competitor_id,
    canonical_summary: truncate(matchedSignal.raw_text, CANONICAL_SUMMARY_MAX_LENGTH),
    matched_signal_id: matchedSignal.id,
    matched_source: matchedSignal.source,
    new_signal_id: signal.id,
    new_source: signal.source,
  });
  logger.info("deduplicator: created a new cluster for a duplicate pair", {
    signal_id: signal.id,
    matched_signal_id: matchedSignal.id,
    cluster_id: cluster.id,
    corroboration_count: cluster.corroboration_count,
  });
}

// Extension point — must only be called from the standalone worker process
// entrypoint, same as every collector's initXWorker(). Not called here so
// importing this module never starts a live Worker as a side effect.
export function initDeduplicatorWorker() {
  return registerWorker("pipeline-deduplication", deduplicatorProcessor);
}
