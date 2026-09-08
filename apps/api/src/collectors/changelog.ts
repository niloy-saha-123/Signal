// BullMQ collector — parses competitor RSS/Atom changelog feeds every 12h.
import type { Job } from "bullmq";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
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

const SERVICE_NAME = "changelog";
const SOURCE = "changelog" as const;

// ponytail: rss-parser stashes RSS2's <content:encoded> under a literal
// 'content:encoded' key rather than aliasing it onto `.content` (that field
// is populated from <description> instead, which is usually just a
// summary) — see node_modules/rss-parser/lib/parser.js. A naive char-length
// check on whatever's embedded stands in for "is this actually full text or
// just an excerpt"; tune the threshold or swap in a real readability check
// if feeds start round-tripping through the fetch fallback unnecessarily.
const MIN_FULLTEXT_CHARS = 500;

interface ChangelogFeedItem {
  "content:encoded"?: string;
}

const parser = new Parser<Record<string, unknown>, ChangelogFeedItem>();

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
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetching changelog entry ${url} returned ${response.status}`);
  }
  return parseArticleContent(await response.text());
}

async function resolveRawText(item: Parser.Item & ChangelogFeedItem, sourceUrl: string): Promise<string> {
  const embeddedHtml = item["content:encoded"] ?? item.content ?? item.summary ?? "";
  const embeddedText = embeddedHtml ? parseArticleContent(embeddedHtml) : "";

  if (embeddedText.length >= MIN_FULLTEXT_CHARS) {
    return embeddedText;
  }

  // Never Playwright here — changelog pages are static HTML, and Playwright
  // is 10x slower for a case Cheerio already handles (skill doc).
  return withRetry(() => fetchArticleText(sourceUrl));
}

async function collectForCompetitor(competitor: {
  id: string;
  name: string;
  changelog_rss: string;
}): Promise<void> {
  const lastCollectedAt = await getLatestSignalCollectedAt(competitor.id, SOURCE);
  const feed = await withRetry(() => parser.parseURL(competitor.changelog_rss));

  for (const item of feed.items ?? []) {
    const sourceUrl = item.link;
    if (!sourceUrl) continue;

    const publishedAt = item.isoDate ?? item.pubDate;
    if (lastCollectedAt && publishedAt) {
      const entryDate = new Date(publishedAt);
      if (!Number.isNaN(entryDate.getTime()) && entryDate <= lastCollectedAt) continue;
    }

    const alreadyCollected = await signalExistsBySourceUrl(competitor.id, SOURCE, sourceUrl);
    if (alreadyCollected) continue;

    const rawText = await resolveRawText(item, sourceUrl);
    if (!rawText) continue;

    const signal = await createSignal({
      competitor_id: competitor.id,
      source: SOURCE,
      source_url: sourceUrl,
      title: item.title ?? null,
      raw_text: rawText,
    });

    await queues["pipeline-entity-extraction"].add("extract-entities", { signal_id: signal.id });
  }
}

interface ChangelogCollectJobData {
  // No fields needed — every run sweeps all active competitors.
}

async function recordCircuitFailure(err: unknown): Promise<void> {
  try {
    await recordFailure(SERVICE_NAME, err instanceof Error ? err.message : String(err));
  } catch (recordErr) {
    // recordFailure makes unguarded Redis calls that can themselves throw —
    // never let that mask the real error below.
    logger.error("Failed to record circuit-breaker failure for changelog", { error: recordErr });
  }
}

export async function changelogCollectorProcessor(_job: Job<ChangelogCollectJobData>): Promise<void> {
  if (await isCircuitOpen(SERVICE_NAME)) {
    throw new Error(`${SERVICE_NAME} circuit is open — skipping job`);
  }

  try {
    const competitors = (await listCompetitors()).filter(
      (c): c is typeof c & { changelog_rss: string } => c.is_active && Boolean(c.changelog_rss)
    );

    // One competitor's feed failing (after withRetry exhausts its attempts)
    // must not abort collection for every other competitor in this run —
    // same per-competitor isolation as hn.ts/reddit.ts.
    let hadFailure = false;
    for (const competitor of competitors) {
      try {
        await collectForCompetitor(competitor);
      } catch (err) {
        hadFailure = true;
        logger.error("changelog collector failed for one competitor — continuing with the rest", {
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
    // Failure outside the per-competitor loop (e.g. listCompetitors() itself)
    // — a real job-level failure, not one competitor's problem, so this one
    // still rethrows.
    await recordCircuitFailure(err);
    throw err;
  }
}

// Extension point — must only be called from the standalone worker process
// entrypoint (not built yet), same as registry.ts's initWorkers(). Not
// called here so importing this module never starts a live Worker as a
// side effect.
export function initChangelogWorker() {
  return registerWorker("collect-changelog", changelogCollectorProcessor);
}
