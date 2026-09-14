// BullMQ collector — pulls posts/comments from configured subreddits via Reddit's OAuth API every 6h.
import type { Job } from "bullmq";
import { z } from "zod";
import { withRetry } from "../lib/retry";
import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { logger } from "../lib/logger";
import { registerWorker } from "../queues/registry";
import { enqueueInitialSignalPipeline } from "../pipeline/recovery";
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

const SERVICE_NAME = "reddit";
const SOURCE = "reddit" as const;
// First run for a competitor+source has no watermark — collect a
// reasonable initial window instead of the entire subreddit history.
const INITIAL_WINDOW_SECONDS = 7 * 24 * 3600;
const POSTS_PER_SUBREDDIT = 25;

const RedditTokenResponseSchema = z.object({
  access_token: z.string().trim().min(1),
});

const RedditPostDataSchema = z.object({
  id: z.string().trim().min(1),
  permalink: z.string().startsWith("/"),
  title: z.string(),
  selftext: z.string(),
  created_utc: z.number().finite().nonnegative(),
});
type RedditPostData = z.infer<typeof RedditPostDataSchema>;

const RedditListingResponseSchema = z.object({
  data: z.object({
    children: z.array(z.object({ data: RedditPostDataSchema })),
    after: z.string().trim().min(1).nullable().optional(),
  }),
});

const BACKFILL_PAGE_LIMIT = 10;
const BACKFILL_POSTS_PER_PAGE = 100;

// Reddit tokens are valid for ~1 hour — the caller fetches this once per job
// run and reuses it across every competitor/subreddit instead of re-auth'ing
// per request.
async function getRedditAccessToken(): Promise<string> {
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`Reddit OAuth token request returned ${response.status}`);
  }
  const parsed = RedditTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Reddit OAuth token response was invalid");
  return parsed.data.access_token;
}

async function fetchSubredditPosts(
  subreddit: string,
  token: string,
  limit: number,
  after?: string
): Promise<{ posts: RedditPostData[]; after: string | null }> {
  const params = new URLSearchParams({
    limit: String(limit),
    ...(after === undefined ? {} : { after }),
  });
  const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new.json?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": process.env.REDDIT_USER_AGENT ?? "Signal/1.0",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`Reddit API returned ${response.status} for r/${subreddit}`);
  }
  const parsed = RedditListingResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Reddit listing response was invalid");
  return {
    posts: parsed.data.data.children.map((child) => child.data),
    after: parsed.data.data.after ?? null,
  };
}

async function collectForCompetitor(
  competitor: { id: string; name: string; subreddits: string[] },
  token: string,
  backfill?: HistoricalCollectionWindow
): Promise<void> {
  if (competitor.subreddits.length === 0) return;

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
  const postsPerPage = backfill ? BACKFILL_POSTS_PER_PAGE : POSTS_PER_SUBREDDIT;

  // subreddits is auto-discovered (per CLAUDE.md), so a stale/banned/private/
  // typo'd entry is a realistic failure mode — one bad subreddit must not
  // starve this competitor's remaining, healthy subreddits every 6h run.
  // Isolate per subreddit and keep going; failures surface once, after every
  // subreddit has had a chance to run, so the caller's existing per-competitor
  // circuit-breaker recording still fires exactly as it did before this loop
  // had multiple subreddits per competitor.
  const failedSubreddits: string[] = [];

  for (const subreddit of competitor.subreddits) {
    try {
      let after: string | undefined;
      let truncated = false;

      for (let page = 0; page < pageLimit; page += 1) {
        const listing = await withRetry(() =>
          fetchSubredditPosts(subreddit, token, postsPerPage, after)
        );
        const posts = listing.posts;

        for (const post of posts) {
          if (post.created_utc <= sinceUnixSeconds) continue;
          if (untilUnixSeconds !== undefined && post.created_utc > untilUnixSeconds) continue;

          const rawText = post.selftext || post.title || "";
          if (!rawText) continue;

          const sourceUrl = `https://www.reddit.com${post.permalink}`;

          // One post throwing (dedup check, insert, or enqueue) must not abort
          // the rest of this subreddit's batch — same isolation one level up
          // as the per-subreddit loop, just per-item here.
          try {
            const alreadyCollected = await signalExistsBySourceUrl(
              competitor.id,
              SOURCE,
              sourceUrl
            );
            if (alreadyCollected) continue;

            const signal = await createSignal({
              competitor_id: competitor.id,
              source: SOURCE,
              source_url: sourceUrl,
              title: post.title ?? null,
              raw_text: rawText,
            });

            await enqueueInitialSignalPipeline(signal.id);
          } catch (err) {
            logger.error("reddit collector failed to process one item — continuing with the rest", {
              competitor_id: competitor.id,
              competitor_name: competitor.name,
              subreddit,
              reddit_post_id: post.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        after = listing.after ?? undefined;
        if (!after) break;
        truncated = page + 1 === pageLimit;
      }

      if (truncated) {
        logger.warn("Reddit backfill reached its page cap; results are truncated", {
          competitor_id: competitor.id,
          subreddit,
          processed_pages: pageLimit,
        });
      }
    } catch (err) {
      failedSubreddits.push(subreddit);
      logger.error("reddit collector failed for one subreddit — continuing with the rest", {
        competitor_id: competitor.id,
        competitor_name: competitor.name,
        subreddit,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failedSubreddits.length > 0) {
    throw new Error(
      `Failed to collect ${failedSubreddits.length} subreddit(s) for competitor ${competitor.id}: ${failedSubreddits.join(", ")}`
    );
  }
}

async function recordCircuitFailure(err: unknown): Promise<void> {
  try {
    await recordFailure(SERVICE_NAME, err instanceof Error ? err.message : String(err));
  } catch (recordErr) {
    // recordFailure makes unguarded Redis calls that can themselves throw —
    // never let that mask the real error below.
    logger.error("Failed to record circuit-breaker failure for reddit", { error: recordErr });
  }
}

export async function redditCollectorProcessor(_job: Job<CollectorJobData>): Promise<void> {
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
    // Fetched once, outside the per-competitor loop, so a token-request
    // failure is a job-level failure (like listCompetitors() failing below)
    // rather than something silently retried per competitor.
    const token = await withRetry(() => getRedditAccessToken());

    // One competitor's subreddit fetch failing (after withRetry exhausts its
    // attempts) must not abort collection for every other competitor in
    // this run — isolate each competitor's work so a single bad subreddit
    // doesn't zero out the whole job. recordSuccess only fires when every
    // competitor came back clean, so a partial run still shows up as
    // degraded circuit-breaker health rather than silently looking fine.
    let hadFailure = false;
    // Set when the loop exits via the mid-run circuit trip below, rather
    // than by running out of competitors — that's not a clean run, so it
    // must not let the trailing recordSuccess() force-close a circuit that
    // was correctly just observed open (e.g. tripped by a concurrent run of
    // this same collector — collect-reddit runs at concurrency 2).
    let circuitTrippedMidRun = false;
    for (const competitor of competitors) {
      // The breaker can trip mid-run off an earlier competitor's failures —
      // re-check before every attempt so the remaining competitors don't
      // each still pay the full withRetry cost against a dependency the
      // breaker just confirmed is down.
      if (await isCircuitOpen(SERVICE_NAME)) {
        circuitTrippedMidRun = true;
        logger.warn("reddit circuit opened mid-run — stopping before remaining competitors", {
          competitor_id: competitor.id,
          competitor_name: competitor.name,
        });
        break;
      }

      try {
        await collectForCompetitor(competitor, token, jobData.backfill);
      } catch (err) {
        hadFailure = true;
        logger.error("reddit collector failed for one competitor — continuing with the rest", {
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
    // Failure outside the per-competitor loop (e.g. listCompetitors() or the
    // OAuth token request itself) — a real job-level failure, not one
    // competitor's problem, so this one still rethrows.
    if (!circuitFailureRecorded) await recordCircuitFailure(err);
    throw err;
  }
}

// Extension point — must only be called from the standalone worker process
// entrypoint (not built yet), same as registry.ts's initWorkers(). Not
// called here so importing this module never starts a live Worker as a
// side effect.
export function initRedditWorker() {
  return registerWorker("collect-reddit", redditCollectorProcessor);
}
