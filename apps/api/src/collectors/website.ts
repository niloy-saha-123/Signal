// BullMQ collector — watches the competitor's own marketing site for copy that
// changed, every 24h.
//
// A changelog says what shipped. A website says what a company wants believed
// about itself, and a rewrite of the homepage or the product page is a
// positioning decision somebody signed off on — usually before any post
// explains it. That makes it first-party evidence of intent rather than
// commentary about it.
//
// Only *changes* become signals. Storing the page every day would bury the
// pipeline in identical copy, so each run diffs against the last snapshot and
// emits a signal only when enough text actually moved.
import type { Job } from "bullmq";
import * as cheerio from "cheerio";
import { withRetry } from "../lib/retry";
import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { logger } from "../lib/logger";
import { registerWorker } from "../queues/registry";
import { enqueueInitialSignalPipeline } from "../pipeline/recovery";
import {
  listCompetitors,
  createSignal,
  getLatestWebsiteSnapshot,
  createWebsiteSnapshot,
} from "../db/queries";
import { assertPublicUrl, safeFetch } from "../lib/safe-fetch";

const SERVICE_NAME = "website";
const SOURCE = "website" as const;

const MAX_PAGE_BYTES = 3_000_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES_PER_COMPETITOR = 6;
const MAX_SIGNAL_CHARS = 12_000;

// Below this, the "change" is almost always a rotating testimonial, a build
// hash, or a visitor counter. Above it, somebody edited the copy.
// ponytail: a flat character threshold; a long docs page and a short pricing
// page get the same bar. Proportional diffing is the upgrade path if short
// pages turn out to under-report.
const MIN_CHANGED_CHARS = 120;

// Same extraction contract as the changelog collector: strip chrome, prefer
// semantic containers, fall back to the body.
function extractText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript, svg").remove();
  const text = $("main, article, [role='main']").first().text() || $("body").text();
  // Collapse whitespace so reflowed markup does not read as changed copy.
  return text.replace(/\s+/g, " ").trim();
}

// Function words appear on every page, so on their own they say nothing about
// whether a phrase is new — but letting them end a run chops a genuinely new
// sentence into fragments ("fully managed Postgres ... for ... teams") short
// enough to fall under MIN_CHANGED_CHARS, and a real rewrite then reads as
// cosmetic churn.
const STOPWORDS = new Set([
  "a", "an", "and", "or", "the", "for", "with", "to", "of", "in", "on", "at", "by",
  "is", "are", "be", "our", "your", "we", "you", "it", "as", "no", "from", "that",
]);

// Word-level difference, reported as the runs of words present now that were
// not present before. Cheap and good enough to answer "what did they start
// saying".
export function changedText(previous: string, current: string): string {
  const before = new Set(previous.toLowerCase().split(" "));
  const added: string[] = [];
  let run: string[] = [];
  // A run of nothing but function words is glue, not new copy.
  let runHasNewWord = false;

  const flush = () => {
    // Keep only runs long enough to be a phrase rather than a stray word.
    if (run.length >= 4 && runHasNewWord) added.push(run.join(" "));
    run = [];
    runHasNewWord = false;
  };

  for (const word of current.split(" ")) {
    const lower = word.toLowerCase();
    if (STOPWORDS.has(lower)) {
      run.push(word);
    } else if (before.has(lower)) {
      flush();
    } else {
      run.push(word);
      runHasNewWord = true;
    }
  }
  flush();

  return added.join(" … ");
}

async function fetchPageText(url: string): Promise<string> {
  await assertPublicUrl(url);
  const response = await safeFetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    maxBytes: MAX_PAGE_BYTES,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Fetching ${url} returned ${response.status}`);
  }
  return extractText(await response.text());
}

async function collectForCompetitor(competitor: {
  id: string;
  name: string;
  website_urls: string[];
}): Promise<void> {
  for (const url of competitor.website_urls.slice(0, MAX_PAGES_PER_COMPETITOR)) {
    // One page failing must not cost the others.
    try {
      const current = await withRetry(() => fetchPageText(url));
      if (!current) continue;

      const previous = await getLatestWebsiteSnapshot(competitor.id, url);

      // First sight of a page is a baseline, not news. Emitting it would report
      // a competitor's entire existing homepage as a change on day one.
      if (!previous) {
        await createWebsiteSnapshot({ competitor_id: competitor.id, url, content: current });
        continue;
      }

      if (previous.content === current) continue;

      const added = changedText(previous.content, current);
      if (added.length < MIN_CHANGED_CHARS) {
        // Cosmetic churn. Still re-baseline, or the same trivial diff is
        // recomputed against a stale snapshot every day forever.
        await createWebsiteSnapshot({ competitor_id: competitor.id, url, content: current });
        continue;
      }

      const signal = await createSignal({
        competitor_id: competitor.id,
        source: SOURCE,
        source_url: url,
        title: `Website copy changed: ${url}`,
        raw_text: `New or rewritten copy on ${url}:\n\n${added.slice(0, MAX_SIGNAL_CHARS)}`,
      });
      await createWebsiteSnapshot({ competitor_id: competitor.id, url, content: current });
      await enqueueInitialSignalPipeline(signal.id);
    } catch (err) {
      logger.error("website collector failed for one page — continuing with the rest", {
        competitor_id: competitor.id,
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

interface WebsiteCollectJobData {
  // No fields — every run sweeps all active competitors with watched pages.
}

async function recordCircuitFailure(err: unknown): Promise<void> {
  try {
    await recordFailure(SERVICE_NAME, err instanceof Error ? err.message : String(err));
  } catch (recordErr) {
    logger.error("Failed to record circuit-breaker failure for website", { error: recordErr });
  }
}

export async function websiteCollectorProcessor(_job: Job<WebsiteCollectJobData>): Promise<void> {
  if (await isCircuitOpen(SERVICE_NAME)) {
    throw new Error(`${SERVICE_NAME} circuit is open — skipping job`);
  }

  try {
    const competitors = (await listCompetitors()).filter(
      (c): c is typeof c & { website_urls: string[] } =>
        c.is_active && Array.isArray(c.website_urls) && c.website_urls.length > 0
    );

    let hadFailure = false;
    let stoppedEarly = false;

    for (const competitor of competitors) {
      if (await isCircuitOpen(SERVICE_NAME)) {
        stoppedEarly = true;
        logger.warn("website circuit opened mid-run — stopping before remaining competitors", {
          competitor_id: competitor.id,
        });
        break;
      }
      try {
        await collectForCompetitor(competitor);
      } catch (err) {
        hadFailure = true;
        logger.error("website collector failed for one competitor — continuing", {
          competitor_id: competitor.id,
          error: err instanceof Error ? err.message : String(err),
        });
        await recordCircuitFailure(err);
      }
    }

    if (!hadFailure && !stoppedEarly) await recordSuccess(SERVICE_NAME);
  } catch (err) {
    await recordCircuitFailure(err);
    throw err;
  }
}

export function initWebsiteWorker() {
  return registerWorker("collect-website", websiteCollectorProcessor);
}
