// BullMQ job — every 12h: scan homepages for the competitor's own feeds and
// accounts, then read blog, social and forum feeds. One job, four sweeps, four
// circuits: a dead forum host must not stop blog collection.
import type { Job } from "bullmq";
import { safeFetch } from "../lib/safe-fetch";
import { withRetry } from "../lib/retry";
import { logger } from "../lib/logger";
import { registerWorker } from "../queues/registry";
import { saveDiscoveredLinks, type Competitor } from "../db/queries";
import type { SignalSource } from "@signal/shared";
import { runSourceSweep } from "./sweep";
import { collectFeed } from "./changelog";
import { extractLinks } from "./links";

const RESCAN_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_HOMEPAGE_BYTES = 3_000_000;
const MAX_ITEMS_PER_FEED = 20;

function needsLinkScan(c: Competitor): true | null {
  if (c.is_own_company) return null;
  if (!c.links_scanned_at) return true;
  return Date.now() - c.links_scanned_at.getTime() > RESCAN_AFTER_MS ? true : null;
}

async function scanLinks(c: Competitor): Promise<void> {
  const pageUrl = `https://${c.domain}/`;
  const html = await withRetry(async () => {
    const res = await safeFetch(pageUrl, {
      signal: AbortSignal.timeout(30_000),
      maxBytes: MAX_HOMEPAGE_BYTES,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`${pageUrl} returned ${res.status}`);
    return res.text();
  });
  const found = extractLinks(html, pageUrl);
  const known = new Set([c.changelog_rss, c.postings_rss].filter(Boolean));
  const blogFeeds = found.blog_feeds.filter((url) => !known.has(url));

  // Fill only what the user hasn't set — a scan never overwrites config.
  const patch: Parameters<typeof saveDiscoveredLinks>[1] = {};
  if (c.blog_feeds.length === 0 && blogFeeds.length) patch.blog_feeds = blogFeeds;
  if (c.social_feeds.length === 0 && found.social_feeds.length) patch.social_feeds = found.social_feeds;
  if (!c.bluesky_handle && found.bluesky_handle) patch.bluesky_handle = found.bluesky_handle;
  if (!c.stackoverflow_tag && found.stackoverflow_tag) patch.stackoverflow_tag = found.stackoverflow_tag;
  await saveDiscoveredLinks(c.id, patch);
}

async function collectFeeds(
  c: Competitor,
  urls: string[],
  source: SignalSource,
  fullText: boolean
): Promise<void> {
  let failed = 0;
  for (const url of urls) {
    try {
      await collectFeed(c, url, source, { fullText, maxItems: MAX_ITEMS_PER_FEED });
    } catch (err) {
      failed++;
      logger.error(`${source} feed failed — continuing with the rest`, {
        competitor_id: c.id,
        feed_url: url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (failed > 0) throw new Error(`${failed} of ${urls.length} ${source} feeds failed`);
}

const nonEmpty = (urls: string[]) => (urls.length ? urls : null);

export async function feedsCollectorProcessor(_job: Job): Promise<void> {
  const sweeps: [string, () => Promise<void>][] = [
    ["links", () => runSourceSweep("links", needsLinkScan, (c) => scanLinks(c))],
    ["blog", () => runSourceSweep("blog", (c) => nonEmpty(c.blog_feeds), (c, urls) => collectFeeds(c, urls, "blog", true))],
    // Feed text only: a YouTube or Mastodon page fetch is megabytes of chrome.
    ["social-feeds", () => runSourceSweep("social-feeds", (c) => nonEmpty(c.social_feeds), (c, urls) => collectFeeds(c, urls, "social", false))],
    ["forums", () => runSourceSweep("forums", (c) => nonEmpty(c.forum_feeds), (c, urls) => collectFeeds(c, urls, "community", false))],
  ];

  let firstError: unknown;
  for (const [name, run] of sweeps) {
    try {
      await run();
    } catch (err) {
      logger.error(`feeds job: ${name} sweep failed — continuing with the next`, {
        error: err instanceof Error ? err.message : String(err),
      });
      firstError ??= err;
    }
  }
  if (firstError) throw firstError;
}

export function initFeedsWorker() {
  return registerWorker("collect-feeds", feedsCollectorProcessor);
}
