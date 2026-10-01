// BullMQ collectors — parse competitor RSS/Atom feeds every 12h.
//
// Two feeds, one parser. A changelog (engineering: what shipped) and a newsroom
// or press feed (company: what it wants announced) are both RSS, and both need
// the same careful full-text resolution below. They are kept as separate
// sources rather than merged because they say different things — a press
// release states intent, a changelog entry states fact — and the quality
// scorer weights them differently for exactly that reason.
import type { Job } from "bullmq";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import { withRetry } from "../lib/retry";
import { logger } from "../lib/logger";
import { registerWorker } from "../queues/registry";
import { enqueueInitialSignalPipeline } from "../pipeline/recovery";
import {
  getLatestSignalCollectedAt,
  signalExistsBySourceUrl,
  createSignal,
} from "../db/queries";
import type { Competitor } from "../db/queries";
import type { SignalSource } from "@signal/shared";
import { assertPublicUrl, safeFetch } from "../lib/safe-fetch";
import { runSourceSweep } from "./sweep";

const MAX_CHANGELOG_BYTES = 2_000_000;

// rss-parser stashes RSS2's <content:encoded> under a literal
// 'content:encoded' key rather than aliasing it onto `.content` (that field
// is populated from <description> instead, which is usually just a
// summary) — see node_modules/rss-parser/lib/parser.js.
interface ChangelogFeedItem {
  "content:encoded"?: string;
}

const parser = new Parser<Record<string, unknown>, ChangelogFeedItem>({ timeout: 30000 });

// Per .claude/skills/signal-scraping/SKILL.md's parseArticleContent pattern
// exactly — strip boilerplate tags, prefer semantic content containers, fall
// back to full body text. Reused for embedded feed HTML too (a fragment
// loads fine under cheerio; there's just no nav/header/footer to strip).
function parseArticleContent(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header").remove();
  return $("article, main, .content").first().text().trim() || $("body").text().trim();
}

async function fetchArticleText(url: string): Promise<string> {
  const response = await safeFetch(url, {
    signal: AbortSignal.timeout(30000),
    maxBytes: MAX_CHANGELOG_BYTES,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Fetching changelog entry ${url} returned ${response.status}`);
  }
  return parseArticleContent(await response.text());
}

async function fetchFeed(url: string) {
  const response = await safeFetch(url, {
    signal: AbortSignal.timeout(30000),
    maxBytes: MAX_CHANGELOG_BYTES,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Fetching changelog feed ${url} returned ${response.status}`);
  }
  return parser.parseString(await response.text());
}

async function resolveRawText(
  item: Parser.Item & ChangelogFeedItem,
  sourceUrl: string,
  fullText: boolean
): Promise<string> {
  if (!fullText) {
    const body =
      parseArticleContent(item["content:encoded"] ?? item.content ?? "") || (item.contentSnippet ?? "");
    return item.title ? `${item.title}\n\n${body}` : body;
  }

  // content:encoded is RSS2's dedicated full-body field — spec-guaranteed
  // complete, so trust it outright, no length check. A short one (e.g.
  // "v2.1: bug fixes") is still complete text, not a truncated summary.
  if (item["content:encoded"]) {
    return parseArticleContent(item["content:encoded"]);
  }

  // No content:encoded: .content/.summary carry real truncation risk — for
  // RSS2 without content:encoded, .content comes from <description>, a
  // synopsis by spec, and CMSes routinely emit long-but-truncated teasers
  // there that clear any length threshold while still being incomplete
  // (and we can't tell that apart from Atom's genuinely-full <content> by
  // length alone). So length never proves completeness here — always fetch
  // the real page instead of trusting this field.
  //
  // Never Playwright here — changelog pages are static HTML, and Playwright
  // is 10x slower for a case Cheerio already handles (skill doc).
  return withRetry(() => fetchArticleText(sourceUrl));
}

export async function collectFeed(
  competitor: Competitor,
  feedUrl: string,
  source: SignalSource,
  opts: { fullText?: boolean; maxItems?: number } = {}
): Promise<void> {
  const { fullText = true, maxItems } = opts;
  const lastCollectedAt = await getLatestSignalCollectedAt(competitor.id, source);
  // parseURL follows redirects internally and cannot re-check their targets.
  // Fetch the bounded body through safeFetch, then parse the inert string.
  const feed = await withRetry(() => fetchFeed(feedUrl));

  let items = feed.items ?? [];
  if (maxItems !== undefined) {
    const ts = (i: (typeof items)[number]) => {
      const t = new Date(i.isoDate ?? i.pubDate ?? "").getTime();
      return Number.isNaN(t) ? -Infinity : t;
    };
    items = [...items].sort((a, b) => ts(b) - ts(a)).slice(0, maxItems);
  }

  for (const item of items) {
    const sourceUrl = item.link;
    if (!sourceUrl) continue;

    const publishedAt = item.isoDate ?? item.pubDate;
    if (lastCollectedAt && publishedAt) {
      const entryDate = new Date(publishedAt);
      if (!Number.isNaN(entryDate.getTime()) && entryDate <= lastCollectedAt) continue;
    }

    // One entry throwing (dedup check, article fetch, insert, or enqueue)
    // must not abort the rest of this competitor's batch — same isolation
    // one level up as the per-competitor loop, just per-item here.
    try {
      // Validate links even when content:encoded means no article fetch. The
      // URL is persisted and later rendered as evidence/source metadata.
      await assertPublicUrl(sourceUrl);
      const alreadyCollected = await signalExistsBySourceUrl(competitor.id, source, sourceUrl);
      if (alreadyCollected) continue;

      const rawText = await resolveRawText(item, sourceUrl, fullText);
      if (!rawText) continue;

      const signal = await createSignal({
        competitor_id: competitor.id,
        source,
        source_url: sourceUrl,
        title: item.title ?? null,
        raw_text: rawText,
      });

      await enqueueInitialSignalPipeline(signal.id);
    } catch (err) {
      logger.error(`${source} collector failed to process one item — continuing with the rest`, {
        competitor_id: competitor.id,
        competitor_name: competitor.name,
        source_url: sourceUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

interface FeedCollectJobData {
  // No fields needed — every run sweeps all active competitors.
}

export async function changelogCollectorProcessor(_job: Job<FeedCollectJobData>): Promise<void> {
  return runSourceSweep("changelog", (c) => c.changelog_rss || null, (c, url) =>
    collectFeed(c, url, "changelog")
  );
}

export async function postingsCollectorProcessor(_job: Job<FeedCollectJobData>): Promise<void> {
  return runSourceSweep("postings", (c) => c.postings_rss || null, (c, url) =>
    collectFeed(c, url, "postings")
  );
}

// Extension points — only called from the standalone worker entrypoint, so
// importing this module never starts a live Worker as a side effect.
export function initChangelogWorker() {
  return registerWorker("collect-changelog", changelogCollectorProcessor);
}

export function initPostingsWorker() {
  return registerWorker("collect-postings", postingsCollectorProcessor);
}
