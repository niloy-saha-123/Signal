// BullMQ collector — new pages in the competitor's docs sitemap, every 24h.
//
// A new docs page is usually the first public trace of a feature: docs ship
// with the release, often before the launch post. Only additions become
// signals; the URL list is diffed against yesterday's, stored in
// website_snapshots keyed by the sitemap URL.
import type { Job } from "bullmq";
import * as cheerio from "cheerio";
import { withRetry } from "../lib/retry";
import { safeFetch } from "../lib/safe-fetch";
import { extractHtmlText } from "../lib/html-text";
import { logger } from "../lib/logger";
import { registerWorker } from "../queues/registry";
import { enqueueInitialSignalPipeline } from "../pipeline/recovery";
import {
  createSignal,
  createWebsiteSnapshot,
  getLatestWebsiteSnapshot,
  setCompetitorDocsSitemapUrl,
  signalExistsBySourceUrl,
  type Competitor,
} from "../db/queries";
import { runSourceSweep } from "./sweep";

const SOURCE = "docs" as const;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_SITEMAP_BYTES = 5_000_000;
const MAX_PAGE_BYTES = 3_000_000;
const MAX_CHILD_SITEMAPS = 5;
// ponytail: sorted-then-capped, so a site past 5k URLs can churn its tail
// between runs. Raise the cap or key on lastmod if a big docs site trips it.
const MAX_URLS = 5_000;
const MAX_PAGE_SIGNALS = 10;
const SUMMARY_PATHS = 20;
const MAX_SIGNAL_CHARS = 12_000;
const BARE_DOMAIN = /^[a-z0-9.-]+$/i;

export function parseSitemap(xml: string): { kind: "urlset" | "index"; locs: string[] } | null {
  const $ = cheerio.load(xml, { xml: true });
  const kind = $("sitemapindex").length ? "index" : $("urlset").length ? "urlset" : null;
  if (!kind) return null;
  const locs = $("loc")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  return { kind, locs };
}

export function sitemapCandidates(c: { domain: string; docs_sitemap_url: string | null }): string[] {
  if (c.docs_sitemap_url) return [c.docs_sitemap_url];
  if (!BARE_DOMAIN.test(c.domain)) return [];
  const domain = c.domain.replace(/^www\./i, "");
  return [`https://docs.${domain}/sitemap.xml`, `https://${domain}/sitemap.xml`];
}

function onHost(url: string, host: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname === host;
  } catch {
    return false;
  }
}

async function fetchText(url: string, maxBytes: number): Promise<string> {
  const res = await safeFetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), maxBytes });
  if (res.status < 200 || res.status >= 300) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

// null = not a sitemap (soft-404 page, wrong content).
async function readSitemap(sitemapUrl: string): Promise<string[] | null> {
  const root = parseSitemap(await withRetry(() => fetchText(sitemapUrl, MAX_SITEMAP_BYTES)));
  if (!root) return null;
  const host = new URL(sitemapUrl).hostname;

  let locs = root.locs;
  if (root.kind === "index") {
    // .gz children would need decompression safeFetch doesn't do.
    const children = root.locs
      .filter((url) => onHost(url, host) && !url.endsWith(".gz"))
      .slice(0, MAX_CHILD_SITEMAPS);
    locs = [];
    for (const child of children) {
      const parsed = parseSitemap(await withRetry(() => fetchText(child, MAX_SITEMAP_BYTES)));
      if (parsed?.kind === "urlset") locs.push(...parsed.locs);
    }
  }
  return [...new Set(locs.filter((url) => onHost(url, host)))].sort().slice(0, MAX_URLS);
}

async function locateSitemap(
  competitor: Competitor
): Promise<{ sitemapUrl: string; urls: string[] } | null> {
  for (const candidate of sitemapCandidates(competitor)) {
    let urls: string[] | null;
    try {
      urls = await readSitemap(candidate);
    } catch (err) {
      // A configured sitemap failing is a real failure; a probe missing is not.
      if (competitor.docs_sitemap_url) throw err;
      continue;
    }
    if (urls) return { sitemapUrl: candidate, urls };
  }
  return null;
}

async function emit(competitorId: string, sourceUrl: string, title: string, rawText: string) {
  const signal = await createSignal({
    competitor_id: competitorId,
    source: SOURCE,
    source_url: sourceUrl,
    title,
    raw_text: rawText.slice(0, MAX_SIGNAL_CHARS),
  });
  await enqueueInitialSignalPipeline(signal.id);
}

async function emitPage(competitorId: string, pageUrl: string): Promise<void> {
  if (await signalExistsBySourceUrl(competitorId, SOURCE, pageUrl)) return;
  const html = await withRetry(() => fetchText(pageUrl, MAX_PAGE_BYTES));
  const text = extractHtmlText(html);
  if (!text) return;
  const title = cheerio.load(html)("title").first().text().trim() || new URL(pageUrl).pathname;
  await emit(competitorId, pageUrl, title.slice(0, 300), `New docs page: ${pageUrl}\n\n${text}`);
}

async function collectDocs(competitor: Competitor): Promise<void> {
  const located = await locateSitemap(competitor);
  if (!located) {
    logger.info("no docs sitemap found — skipping", { competitor_id: competitor.id });
    return;
  }
  const { sitemapUrl, urls } = located;
  if (!competitor.docs_sitemap_url) await setCompetitorDocsSitemapUrl(competitor.id, sitemapUrl);

  const content = urls.join("\n");
  const previous = await getLatestWebsiteSnapshot(competitor.id, sitemapUrl);
  if (previous) {
    const known = new Set(previous.content.split("\n"));
    const added = urls.filter((url) => !known.has(url));

    if (added.length > MAX_PAGE_SIGNALS) {
      // A restructure or a new locale would otherwise flood the feed.
      const sourceUrl = `${sitemapUrl}#${new Date().toISOString().slice(0, 10)}`;
      if (!(await signalExistsBySourceUrl(competitor.id, SOURCE, sourceUrl))) {
        const paths = added.slice(0, SUMMARY_PATHS).map((url) => new URL(url).pathname);
        await emit(
          competitor.id,
          sourceUrl,
          `${added.length} new docs pages`,
          `${added.length} new pages appeared in the docs sitemap ${sitemapUrl}. First ${paths.length}:\n${paths.join("\n")}`
        );
      }
    } else {
      for (const pageUrl of added) {
        try {
          await emitPage(competitor.id, pageUrl);
        } catch (err) {
          logger.error("docs collector failed on one page — continuing with the rest", {
            competitor_id: competitor.id,
            source_url: pageUrl,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // Saved after emitting: a crash mid-emit re-diffs next run, and per-URL
  // signal dedupe absorbs the repeats.
  if (previous?.content !== content) {
    await createWebsiteSnapshot({ competitor_id: competitor.id, url: sitemapUrl, content });
  }
}

export async function docsCollectorProcessor(_job: Job): Promise<void> {
  return runSourceSweep(SOURCE, () => true, (competitor) => collectDocs(competitor));
}

export function initDocsWorker() {
  return registerWorker("collect-docs", docsCollectorProcessor);
}
