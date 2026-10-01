// BullMQ collector — Google News RSS per competitor, every 6h.
//
// Press coverage is edited third-party reporting: slower than a changelog,
// but it is how a funding round, an acquisition or a big customer win becomes
// public. Only the headline, publisher and snippet are stored — Google's
// article links are encoded redirects, so the article body is not fetched.
//
// No published-date cutoff: Google orders by relevance and indexes late, so a
// cutoff drops real articles. The article URL is the dedupe key.
import type { Job } from "bullmq";
import Parser from "rss-parser";
import { withRetry } from "../lib/retry";
import { safeFetch } from "../lib/safe-fetch";
import { extractHtmlText } from "../lib/html-text";
import { logger } from "../lib/logger";
import { registerWorker } from "../queues/registry";
import { enqueueInitialSignalPipeline } from "../pipeline/recovery";
import { createSignal, signalExistsBySourceUrl, type Competitor } from "../db/queries";
import { runSourceSweep } from "./sweep";

const SOURCE = "news" as const;
const MAX_FEED_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ITEMS_PER_RUN = 20;

interface NewsItem {
  // <source url="…">Publisher</source>; xml2js yields a string or { _, $ }.
  source?: unknown;
}

const parser = new Parser<Record<string, unknown>, NewsItem>({
  customFields: { item: ["source"] },
});

export function newsFeedUrl(competitor: { name: string; news_query: string | null }): string {
  const query = `${competitor.news_query ?? `"${competitor.name}"`} when:7d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

function publisherOf(source: unknown): string | null {
  const value =
    typeof source === "string"
      ? source
      : source && typeof source === "object" && "_" in source
        ? source._
        : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function publishedTime(item: Parser.Item): number {
  const time = new Date(item.isoDate ?? item.pubDate ?? "").getTime();
  return Number.isNaN(time) ? 0 : time;
}

async function fetchFeed(url: string) {
  const res = await safeFetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    maxBytes: MAX_FEED_BYTES,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Google News returned ${res.status}`);
  }
  return parser.parseString(await res.text());
}

async function collectNews(competitor: Competitor, feedUrl: string): Promise<void> {
  const feed = await withRetry(() => fetchFeed(feedUrl));
  const items = [...(feed.items ?? [])]
    .sort((a, b) => publishedTime(b) - publishedTime(a))
    .slice(0, MAX_ITEMS_PER_RUN);

  for (const item of items) {
    const link = item.link;
    if (!link) continue;
    try {
      if (await signalExistsBySourceUrl(competitor.id, SOURCE, link)) continue;

      const publisher = publisherOf(item.source);
      const snippet = item.content ? extractHtmlText(item.content) : "";
      const rawText = [item.title, publisher && `Publisher: ${publisher}`, snippet]
        .filter(Boolean)
        .join("\n\n");
      if (!rawText) continue;

      const signal = await createSignal({
        competitor_id: competitor.id,
        source: SOURCE,
        source_url: link,
        title: item.title?.slice(0, 300) ?? null,
        raw_text: rawText,
      });
      await enqueueInitialSignalPipeline(signal.id);
    } catch (err) {
      logger.error("news collector failed to process one item — continuing with the rest", {
        competitor_id: competitor.id,
        source_url: link,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function newsCollectorProcessor(_job: Job): Promise<void> {
  return runSourceSweep(
    SOURCE,
    // Own-company rows are only watched when explicitly configured.
    (c) => (c.is_own_company && !c.news_query ? null : newsFeedUrl(c)),
    collectNews
  );
}

export function initNewsWorker() {
  return registerWorker("collect-news", newsCollectorProcessor);
}
