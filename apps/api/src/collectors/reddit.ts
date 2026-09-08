// BullMQ collector — pulls posts/comments from configured subreddits via Reddit's OAuth API every 6h.
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

const SERVICE_NAME = "reddit";
const SOURCE = "reddit" as const;
// First run for a competitor+source has no watermark — collect a
// reasonable initial window instead of the entire subreddit history.
const INITIAL_WINDOW_SECONDS = 7 * 24 * 3600;
const POSTS_PER_SUBREDDIT = 25;

interface RedditTokenResponse {
  access_token: string;
}

interface RedditPostData {
  id: string;
  permalink: string;
  title: string;
  selftext: string;
  created_utc: number;
}

interface RedditListingResponse {
  data: {
    children: Array<{ data: RedditPostData }>;
  };
}

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
  });
  if (!response.ok) {
    throw new Error(`Reddit OAuth token request returned ${response.status}`);
  }
  const data = (await response.json()) as RedditTokenResponse;
  return data.access_token;
}

async function fetchSubredditPosts(subreddit: string, token: string): Promise<RedditPostData[]> {
  const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new.json?limit=${POSTS_PER_SUBREDDIT}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": process.env.REDDIT_USER_AGENT ?? "Signal/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Reddit API returned ${response.status} for r/${subreddit}`);
  }
  const data = (await response.json()) as RedditListingResponse;
  return (data.data?.children ?? []).map((child) => child.data);
}

async function collectForCompetitor(
  competitor: { id: string; name: string; subreddits: string[] },
  token: string
): Promise<void> {
  if (competitor.subreddits.length === 0) return;

  const lastCollectedAt = await getLatestSignalCollectedAt(competitor.id, SOURCE);
  const sinceUnixSeconds = lastCollectedAt
    ? Math.floor(lastCollectedAt.getTime() / 1000)
    : Math.floor(Date.now() / 1000) - INITIAL_WINDOW_SECONDS;

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
      const posts = await withRetry(() => fetchSubredditPosts(subreddit, token));

      for (const post of posts) {
        if (post.created_utc <= sinceUnixSeconds) continue;

        const rawText = post.selftext || post.title || "";
        if (!rawText) continue;

        const sourceUrl = `https://www.reddit.com${post.permalink}`;

        const alreadyCollected = await signalExistsBySourceUrl(competitor.id, SOURCE, sourceUrl);
        if (alreadyCollected) continue;

        const signal = await createSignal({
          competitor_id: competitor.id,
          source: SOURCE,
          source_url: sourceUrl,
          title: post.title ?? null,
          raw_text: rawText,
        });

        await queues["pipeline-entity-extraction"].add("extract-entities", { signal_id: signal.id });
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

interface RedditCollectJobData {
  // No fields needed — every run sweeps all active competitors.
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

export async function redditCollectorProcessor(_job: Job<RedditCollectJobData>): Promise<void> {
  if (await isCircuitOpen(SERVICE_NAME)) {
    throw new Error(`${SERVICE_NAME} circuit is open — skipping job`);
  }

  try {
    const competitors = (await listCompetitors()).filter((c) => c.is_active);
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
    for (const competitor of competitors) {
      try {
        await collectForCompetitor(competitor, token);
      } catch (err) {
        hadFailure = true;
        logger.error("reddit collector failed for one competitor — continuing with the rest", {
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
    // Failure outside the per-competitor loop (e.g. listCompetitors() or the
    // OAuth token request itself) — a real job-level failure, not one
    // competitor's problem, so this one still rethrows.
    await recordCircuitFailure(err);
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
