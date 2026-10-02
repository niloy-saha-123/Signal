// BullMQ collector — a competitor's own Bluesky posts (source "social"), every 6h.
// Public AppView endpoint, no auth. Reposts and replies are not the company's voice.
import type { Job } from "bullmq";
import { withRetry } from "../lib/retry";
import { safeFetch } from "../lib/safe-fetch";
import { logger } from "../lib/logger";
import { registerWorker } from "../queues/registry";
import { enqueueInitialSignalPipeline } from "../pipeline/recovery";
import { createSignal, signalExistsBySourceUrl, type Competitor } from "../db/queries";
import { runSourceSweep, ConfigError } from "./sweep";

const SERVICE = "bluesky";
const SOURCE = "social" as const;
const MAX_POSTS = 20;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface Post {
  rkey: string;
  text: string;
  createdAt: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function parsePosts(body: unknown, handle: string): Post[] {
  if (!isRecord(body) || !Array.isArray(body.feed)) return [];
  const posts: Post[] = [];
  const minCreated = Date.now() - MAX_AGE_MS;
  let byAuthor = 0;
  for (const item of body.feed) {
    if (!isRecord(item) || "reason" in item || !isRecord(item.post)) continue;
    const { uri, author, record } = item.post;
    if (typeof uri !== "string" || !isRecord(author) || !isRecord(record)) continue;
    if (typeof author.handle !== "string" || author.handle.toLowerCase() !== handle) continue;
    byAuthor++;
    if (typeof record.text !== "string" || !record.text.trim()) continue;
    const created = typeof record.createdAt === "string" ? Date.parse(record.createdAt) : NaN;
    if (Number.isNaN(created) || created < minCreated) continue;
    const rkey = uri.split("/").pop() ?? "";
    if (!/^[a-z0-9]+$/i.test(rkey)) continue;
    posts.push({
      rkey,
      text: record.text,
      createdAt: record.createdAt as string,
    });
  }
  if (body.feed.length > 0 && byAuthor === 0) {
    // A non-empty feed with nothing by this handle usually means a renamed account.
    logger.warn("bluesky feed has no posts by the configured author", { handle });
  }
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_POSTS);
}

async function fetchFeed(handle: string): Promise<unknown> {
  const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=30&filter=posts_no_replies`;
  return withRetry(
    async () => {
      const res = await safeFetch(url, { signal: AbortSignal.timeout(30_000), maxBytes: 2_000_000 });
      if (res.status === 400) throw new ConfigError(`bluesky rejected handle ${handle}`);
      if (res.status < 200 || res.status >= 300) throw new Error(`${url} returned ${res.status}`);
      return res.json();
    },
    { shouldRetry: (err: unknown) => !(err instanceof ConfigError) }
  );
}

async function collectBluesky(competitor: Competitor, configured: string): Promise<void> {
  const handle = configured.toLowerCase();
  let body: unknown;
  try {
    body = await fetchFeed(handle);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.warn("bluesky handle rejected — check the competitor's handle", {
        competitor_id: competitor.id,
        handle,
        reason: err.message,
      });
      return;
    }
    throw err;
  }

  for (const post of parsePosts(body, handle)) {
    try {
      const sourceUrl = `https://bsky.app/profile/${handle}/post/${post.rkey}`;
      if (await signalExistsBySourceUrl(competitor.id, SOURCE, sourceUrl)) continue;
      const signal = await createSignal({
        competitor_id: competitor.id,
        source: SOURCE,
        source_url: sourceUrl,
        title: post.text.trim().split("\n")[0].slice(0, 120),
        raw_text: `Bluesky post by @${handle}:\n\n${post.text}`,
      });
      try {
        await enqueueInitialSignalPipeline(signal.id);
      } catch (err) {
        // The signal row (and its outbox entry) is committed; pipeline recovery re-enqueues it.
        logger.error("bluesky signal enqueue failed — left for pipeline recovery", {
          signal_id: signal.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      logger.error("bluesky post failed — continuing with the rest", {
        competitor_id: competitor.id,
        rkey: post.rkey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function blueskyCollectorProcessor(_job: Job): Promise<void> {
  return runSourceSweep<string>(SERVICE, (c) => c.bluesky_handle || null, collectBluesky);
}

export function initBlueskyWorker() {
  return registerWorker("collect-bluesky", blueskyCollectorProcessor);
}
