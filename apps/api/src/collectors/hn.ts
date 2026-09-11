// BullMQ collector — pulls competitor mentions from the Algolia HN API every 6h.
import type { Job } from "bullmq";
import { withRetry } from "../lib/retry";
import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { logger } from "../lib/logger";
import { registerWorker, queues } from "../queues/registry";
import {
  listCompetitors,
  getCompetitorById,
  getLatestSignalCollectedAt,
  signalExistsBySourceUrl,
  createSignal,
} from "../db/queries";
import {
  CollectorJobDataSchema,
  resolveCollectorCompetitors,
  type CollectorJobData,
  type HistoricalCollectionWindow,
} from "./job-data";

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
  page?: number;
  nbPages?: number;
}

const BACKFILL_PAGE_LIMIT = 10;
const BACKFILL_HITS_PER_PAGE = 100;

async function searchHn(
  competitorName: string,
  sinceUnixSeconds: number,
  untilUnixSeconds: number | undefined,
  page: number
): Promise<AlgoliaHnResponse> {
  const numericFilters = [
    `created_at_i>${sinceUnixSeconds}`,
    ...(untilUnixSeconds === undefined ? [] : [`created_at_i<=${untilUnixSeconds}`]),
  ].join(",");
  const params = new URLSearchParams({
    query: competitorName,
    tags: "comment",
    numericFilters,
    ...(page === 0 ? {} : { page: String(page) }),
    ...(untilUnixSeconds === undefined ? {} : { hitsPerPage: String(BACKFILL_HITS_PER_PAGE) }),
  });
  const endpoint = untilUnixSeconds === undefined ? "search" : "search_by_date";
  const url = `https://hn.algolia.com/api/v1/${endpoint}?${params.toString()}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    throw new Error(`Algolia HN API returned ${response.status} for query "${competitorName}"`);
  }
  const data = (await response.json()) as AlgoliaHnResponse;
  return data;
}

async function collectForCompetitor(
  competitor: { id: string; name: string },
  backfill?: HistoricalCollectionWindow
): Promise<void> {
  const lastCollectedAt = backfill
    ? undefined
    : await getLatestSignalCollectedAt(competitor.id, SOURCE);
  const sinceUnixSeconds = backfill
    ? Math.floor(Date.parse(backfill.since) / 1000)
    : lastCollectedAt
      ? Math.floor(lastCollectedAt.getTime() / 1000)
      : Math.floor(Date.now() / 1000) - INITIAL_WINDOW_SECONDS;
  const untilUnixSeconds = backfill
    ? Math.floor(Date.parse(backfill.until) / 1000)
    : undefined;
  const pageLimit = backfill ? BACKFILL_PAGE_LIMIT : 1;
  let advertisedPages = 1;

  for (let page = 0; page < pageLimit; page += 1) {
    const response = await withRetry(() =>
      searchHn(competitor.name, sinceUnixSeconds, untilUnixSeconds, page)
    );
    const hits = response.hits ?? [];
    advertisedPages = Math.max(response.nbPages ?? 1, 1);

    for (const hit of hits) {
      if (untilUnixSeconds !== undefined && hit.created_at_i > untilUnixSeconds) continue;
      const rawText = hit.comment_text ?? hit.story_text ?? "";
      if (!rawText) continue;

      // Permalink to the comment itself — the stable per-hit identity used
      // for dedup, since the schema has no source_id column.
      const sourceUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;

      // One hit throwing (dedup check, insert, or enqueue) must not abort the
      // rest of this competitor's batch — same isolation one level up as the
      // per-competitor loop, just per-item here.
      try {
        const alreadyCollected = await signalExistsBySourceUrl(competitor.id, SOURCE, sourceUrl);
        if (alreadyCollected) continue;

        const signal = await createSignal({
          competitor_id: competitor.id,
          source: SOURCE,
          source_url: sourceUrl,
          title: hit.story_title ?? hit.title ?? null,
          raw_text: rawText,
        });

        await withRetry(() =>
          queues["pipeline-entity-extraction"].add("extract-entities", { signal_id: signal.id })
        );
      } catch (err) {
        logger.error("hn collector failed to process one item — continuing with the rest", {
          competitor_id: competitor.id,
          competitor_name: competitor.name,
          hn_object_id: hit.objectID,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (page + 1 >= advertisedPages) break;
  }

  if (backfill && advertisedPages > pageLimit) {
    logger.warn("HN backfill reached its page cap; results are truncated", {
      competitor_id: competitor.id,
      requested_pages: advertisedPages,
      processed_pages: pageLimit,
    });
  }
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

export async function hnCollectorProcessor(_job: Job<CollectorJobData>): Promise<void> {
  const jobData = CollectorJobDataSchema.parse(_job.data ?? {});
  if (await isCircuitOpen(SERVICE_NAME)) {
    throw new Error(`${SERVICE_NAME} circuit is open — skipping job`);
  }

  let circuitFailureRecorded = false;
  try {
    const competitors = await resolveCollectorCompetitors(
      jobData,
      listCompetitors,
      getCompetitorById
    );

    // One competitor's Algolia fetch failing (after withRetry exhausts its
    // attempts) must not abort collection for every other competitor in
    // this run — isolate each competitor's work so a single bad name/query
    // doesn't zero out the whole job. recordSuccess only fires when every
    // competitor came back clean, so a partial run still shows up as
    // degraded circuit-breaker health rather than silently looking fine.
    let hadFailure = false;
    // Set when the loop exits via the mid-run circuit trip below, rather
    // than by running out of competitors — that's not a clean run, so it
    // must not let the trailing recordSuccess() force-close a circuit that
    // was correctly just observed open (e.g. tripped by a concurrent run of
    // this same collector — collect-hn runs at concurrency 2).
    let circuitTrippedMidRun = false;
    for (const competitor of competitors) {
      // The breaker can trip mid-run off an earlier competitor's failures —
      // re-check before every attempt so the remaining competitors don't
      // each still pay the full withRetry cost against a dependency the
      // breaker just confirmed is down.
      if (await isCircuitOpen(SERVICE_NAME)) {
        circuitTrippedMidRun = true;
        logger.warn("hn circuit opened mid-run — stopping before remaining competitors", {
          competitor_id: competitor.id,
          competitor_name: competitor.name,
        });
        break;
      }

      try {
        await collectForCompetitor(competitor, jobData.backfill);
      } catch (err) {
        hadFailure = true;
        logger.error("hn collector failed for one competitor — continuing with the rest", {
          competitor_id: competitor.id,
          competitor_name: competitor.name,
          error: err instanceof Error ? err.message : String(err),
        });
        await recordCircuitFailure(err);
        circuitFailureRecorded = true;
        // Scheduled sweeps retain their established per-competitor isolation.
        // A scoped backfill has no other competitor to save, so rejecting is
        // required for BullMQ to retry its bounded, idempotent work.
        if (jobData.backfill) throw err;
      }
    }

    if (!hadFailure && !circuitTrippedMidRun) {
      await recordSuccess(SERVICE_NAME);
    }
  } catch (err) {
    // Failure outside the per-competitor loop (e.g. listCompetitors()
    // itself) — a real job-level failure, not one competitor's problem, so
    // this one still rethrows.
    if (!circuitFailureRecorded) await recordCircuitFailure(err);
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
