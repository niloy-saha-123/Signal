// BullMQ collector — pulls competitor mentions from the Algolia HN API every 6h.
import type { Job } from "bullmq";
import { withRetry } from "../lib/retry";
import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { logger } from "../lib/logger";
import { registerWorker, queues } from "../queues/registry";
import {
  listCompetitors,
  getLatestSignalCollectedAt,
  signalExistsBySourceUrl,
  createSignal,
} from "../db/queries";

const SERVICE_NAME = "hn";
const SOURCE = "hn" as const;
// First run for a competitor+source has no watermark — collect a
// reasonable initial window instead of the entire HN history.
const INITIAL_WINDOW_SECONDS = 7 * 24 * 3600;

interface AlgoliaHnHit {
  objectID: string;
  created_at_i: number;
  comment_text?: string | null;
  story_text?: string | null;
  story_title?: string | null;
  title?: string | null;
}

interface AlgoliaHnResponse {
  hits: AlgoliaHnHit[];
}

async function searchHn(competitorName: string, sinceUnixSeconds: number): Promise<AlgoliaHnHit[]> {
  const url =
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(competitorName)}` +
    `&tags=comment&numericFilters=created_at_i>${sinceUnixSeconds}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Algolia HN API returned ${response.status} for query "${competitorName}"`);
  }
  const data = (await response.json()) as AlgoliaHnResponse;
  return data.hits ?? [];
}

async function collectForCompetitor(competitor: { id: string; name: string }): Promise<void> {
  const lastCollectedAt = await getLatestSignalCollectedAt(competitor.id, SOURCE);
  const sinceUnixSeconds = lastCollectedAt
    ? Math.floor(lastCollectedAt.getTime() / 1000)
    : Math.floor(Date.now() / 1000) - INITIAL_WINDOW_SECONDS;

  const hits = await withRetry(() => searchHn(competitor.name, sinceUnixSeconds));

  for (const hit of hits) {
    const rawText = hit.comment_text ?? hit.story_text ?? "";
    if (!rawText) continue;

    // Permalink to the comment itself — the stable per-hit identity used
    // for dedup, since the schema has no source_id column.
    const sourceUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;

    const alreadyCollected = await signalExistsBySourceUrl(competitor.id, SOURCE, sourceUrl);
    if (alreadyCollected) continue;

    const signal = await createSignal({
      competitor_id: competitor.id,
      source: SOURCE,
      source_url: sourceUrl,
      title: hit.story_title ?? hit.title ?? null,
      raw_text: rawText,
    });

    await queues["pipeline-entity-extraction"].add("extract-entities", { signal_id: signal.id });
  }
}

interface HnCollectJobData {
  // No fields needed — every run sweeps all active competitors.
}

async function recordCircuitFailure(err: unknown): Promise<void> {
  try {
    await recordFailure(SERVICE_NAME, err instanceof Error ? err.message : String(err));
  } catch (recordErr) {
    // recordFailure makes unguarded Redis calls that can themselves throw —
    // never let that mask the real error below.
    logger.error("Failed to record circuit-breaker failure for hn", { error: recordErr });
  }
}

export async function hnCollectorProcessor(_job: Job<HnCollectJobData>): Promise<void> {
  if (await isCircuitOpen(SERVICE_NAME)) {
    throw new Error(`${SERVICE_NAME} circuit is open — skipping job`);
  }

  try {
    const competitors = (await listCompetitors()).filter((c) => c.is_active);

    // One competitor's Algolia fetch failing (after withRetry exhausts its
    // attempts) must not abort collection for every other competitor in
    // this run — isolate each competitor's work so a single bad name/query
    // doesn't zero out the whole job. recordSuccess only fires when every
    // competitor came back clean, so a partial run still shows up as
    // degraded circuit-breaker health rather than silently looking fine.
    let hadFailure = false;
    for (const competitor of competitors) {
      try {
        await collectForCompetitor(competitor);
      } catch (err) {
        hadFailure = true;
        logger.error("hn collector failed for one competitor — continuing with the rest", {
          competitor_id: competitor.id,
          competitor_name: competitor.name,
          error: err instanceof Error ? err.message : String(err),
        });
        await recordCircuitFailure(err);
      }
    }

    if (!hadFailure) {
      await recordSuccess(SERVICE_NAME);
    }
  } catch (err) {
    // Failure outside the per-competitor loop (e.g. listCompetitors()
    // itself) — a real job-level failure, not one competitor's problem, so
    // this one still rethrows.
    await recordCircuitFailure(err);
    throw err;
  }
}

// Extension point — must only be called from the standalone worker process
// entrypoint (not built yet), same as registry.ts's initWorkers(). Not
// called here so importing this module never starts a live Worker as a
// side effect.
export function initHnWorker() {
  return registerWorker("collect-hn", hnCollectorProcessor);
}
