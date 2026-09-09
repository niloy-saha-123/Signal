// Scores each incoming signal 0.0-1.0 from source authority, recency decay, and completeness.
// No engagement term: the 5 collectors (Part 6) never capture upvotes/points/comment counts —
// nothing exists in `signals` to read one from. This is a deterministic proxy instead: pure
// math, no LLM, no external call — same precedent as PatternDetector keeping count/math work
// out of the LLM layer.
import type { Job } from "bullmq";
import { withRetry } from "../lib/retry";
import { logger } from "../lib/logger";
import { registerWorker, queues } from "../queues/registry";
import { getSignalById, updateSignalQualityScore, type Signal } from "../db/queries";

// First-party channels (the competitor's own site) outrank third-party/community mentions of
// the same fact. pricing/changelog are both first-party and directly competitive; changelog
// sits slightly below pricing because a changelog entry is often marketing copy about a change
// rather than the change itself. jobs is first-party but only weakly a competitive signal (a
// posting implies direction, it doesn't state one). hn/reddit are third-party community
// mentions with no way to verify accuracy — weighted equally since neither source carries
// more inherent authority than the other here.
const SOURCE_AUTHORITY: Record<Signal["source"], number> = {
  pricing: 1.0,
  changelog: 0.85,
  jobs: 0.6,
  hn: 0.3,
  reddit: 0.3,
};

export function sourceAuthorityScore(source: Signal["source"]): number {
  return SOURCE_AUTHORITY[source];
}

// Competitive intel goes stale fast — a 7-day-old signal is worth about half a fresh one.
// Standard exponential decay: score = 0.5 ^ (age / halfLife).
export const RECENCY_HALF_LIFE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function recencyScore(collectedAt: Date, now: Date = new Date()): number {
  const ageDays = (now.getTime() - collectedAt.getTime()) / MS_PER_DAY;
  // Clamp negative age (clock skew / collected_at slightly in the future) to "as fresh as
  // it gets" rather than letting it exceed 1.0.
  if (ageDays <= 0) return 1.0;
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

// A signal with no title or a near-empty body is harder to act on. Minor signal relative to
// authority/recency, so it only ever nudges the score, split evenly between the two fields:
// both present -> 1.0, one missing -> 0.5, neither -> 0.0.
const MIN_RAW_TEXT_LENGTH = 30;

export function completenessScore(title: string | null, rawText: string): number {
  const hasTitle = Boolean(title && title.trim().length > 0);
  const hasBody = rawText.trim().length >= MIN_RAW_TEXT_LENGTH;
  return ((hasTitle ? 1 : 0) + (hasBody ? 1 : 0)) / 2;
}

// Weighted sum, each component pre-clamped to [0,1] so the combination can't leave that
// range on its own — but see the explicit clamp below, kept as a hard backstop rather than
// trusting the arithmetic, per the DB check constraint that will hard-fail an out-of-range write.
const AUTHORITY_WEIGHT = 0.5;
const RECENCY_WEIGHT = 0.4;
const COMPLETENESS_WEIGHT = 0.1;

export function computeQualityScore(
  signal: Pick<Signal, "source" | "collected_at" | "title" | "raw_text">,
  now: Date = new Date()
): number {
  const score =
    AUTHORITY_WEIGHT * sourceAuthorityScore(signal.source) +
    RECENCY_WEIGHT * recencyScore(signal.collected_at, now) +
    COMPLETENESS_WEIGHT * completenessScore(signal.title, signal.raw_text);

  return Math.min(1, Math.max(0, score));
}

interface QualityScoringJobData {
  signal_id: string;
}

export async function qualityScorerProcessor(job: Job<QualityScoringJobData>): Promise<void> {
  const signal = await getSignalById(job.data.signal_id);
  if (!signal) {
    logger.warn("quality-scorer: signal not found — skipping", {
      signal_id: job.data.signal_id,
    });
    return;
  }

  const score = computeQualityScore(signal);
  await updateSignalQualityScore(signal.id, score);

  await withRetry(() =>
    queues["pipeline-deduplication"].add("deduplicate", { signal_id: signal.id })
  );
}

// Extension point — must only be called from the standalone worker process
// entrypoint, same as every collector's initXWorker(). Not called here so
// importing this module never starts a live Worker as a side effect.
export function initQualityScorerWorker() {
  return registerWorker("pipeline-quality-scoring", qualityScorerProcessor);
}
