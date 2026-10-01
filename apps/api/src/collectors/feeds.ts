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
import { runSourceSweep, ConfigError, CircuitOpenError } from "./sweep";
import { collectFeed } from "./changelog";
import { extractLinks } from "./links";

const MAX_HOMEPAGE_BYTES = 3_000_000;
// Shared across all of a competitor's feeds for one source, per run.
const MAX_NEW_SIGNALS_PER_SOURCE = 20;
const MAX_FEED_ITEM_AGE_DAYS = 30;
const MAX_DISCOVERED_FEEDS = 5;

// Scan once: a rescan would refill a list the user deliberately cleared.
function needsLinkScan(c: Competitor): true | null {
  if (c.is_own_company) return null;
  return c.links_scanned_at ? null : true;
}

function normalizeFeedUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return raw;
  }
}

async function scanLinks(c: Competitor): Promise<void> {
  const pageUrl = `https://${c.domain}/`;
  let page: { html: string; finalUrl: string };
  try {
    page = await withRetry(
      async () => {
        const res = await safeFetch(pageUrl, {
          signal: AbortSignal.timeout(30_000),
          maxBytes: MAX_HOMEPAGE_BYTES,
        });
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new ConfigError(`${pageUrl} returned ${res.status}`);
        }
        if (res.status < 200 || res.status >= 300) throw new Error(`${pageUrl} returned ${res.status}`);
        return { html: await res.text(), finalUrl: res.url || pageUrl };
      },
      { shouldRetry: (err) => !(err instanceof ConfigError) }
    );
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // A homepage that refuses us will refuse the next run too; stamp it.
    logger.warn("homepage link scan refused — stamping without links", {
      competitor_id: c.id,
      reason: err.message,
    });
    await saveDiscoveredLinks(c.id, {});
    return;
  }
  const found = extractLinks(page.html, page.finalUrl);
  const known = new Set([c.changelog_rss, c.postings_rss].filter((u): u is string => !!u).map(normalizeFeedUrl));
  const blogFeeds = found.blog_feeds
    .filter((url) => !known.has(normalizeFeedUrl(url)))
    .slice(0, MAX_DISCOVERED_FEEDS);
  const socialFeeds = found.social_feeds.slice(0, MAX_DISCOVERED_FEEDS);

  // Fill only what the user hasn't set — a scan never overwrites config.
  const patch: Parameters<typeof saveDiscoveredLinks>[1] = {};
  if (c.blog_feeds.length === 0 && blogFeeds.length) patch.blog_feeds = blogFeeds;
  if (c.social_feeds.length === 0 && socialFeeds.length) patch.social_feeds = socialFeeds;
  if (!c.bluesky_handle && found.bluesky_handle) patch.bluesky_handle = found.bluesky_handle;
  if (!c.stackoverflow_tag && found.stackoverflow_tag) patch.stackoverflow_tag = found.stackoverflow_tag;
  await saveDiscoveredLinks(c.id, patch);
  logger.info("homepage link scan done", { competitor_id: c.id, fields: Object.keys(patch) });
}

async function collectFeeds(
  c: Competitor,
  urls: string[],
  source: SignalSource,
  fullText: boolean
): Promise<void> {
  let failed = 0;
  let rejected = 0;
  let budget = MAX_NEW_SIGNALS_PER_SOURCE;
  for (const url of urls) {
    if (budget <= 0) break;
    try {
      budget -= await collectFeed(c, url, source, {
        fullText,
        maxItems: budget,
        maxAgeDays: MAX_FEED_ITEM_AGE_DAYS,
      });
    } catch (err) {
      const isConfig = err instanceof ConfigError;
      if (isConfig) rejected++;
      else failed++;
      logger[isConfig ? "warn" : "error"](`${source} feed failed — continuing with the rest`, {
        competitor_id: c.id,
        feed_url: url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Auto-discovered feeds are speculative and circuits are shared across
  // workspaces: one dead feed must not count against the source, only a
  // competitor whose reachable-in-principle feeds all failed.
  if (rejected === urls.length) throw new ConfigError(`all ${urls.length} ${source} feeds rejected`);
  const counted = urls.length - rejected;
  if (failed > 0 && failed === counted) throw new Error(`${failed} of ${urls.length} ${source} feeds failed`);
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
      // An open circuit is a normal state; rethrowing would make BullMQ retry
      // the whole job and refetch every healthy feed.
      if (err instanceof CircuitOpenError) {
        logger.warn(`feeds job: ${name} circuit open — skipped`);
        continue;
      }
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
