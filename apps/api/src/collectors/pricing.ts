// BullMQ collector — scrapes competitor pricing pages via Playwright every 48h,
// storing a snapshot baseline and, when a prior baseline exists, a structural diff.
import type { Job } from "bullmq";
import { chromium } from "playwright";
import { withRetry } from "../lib/retry";
import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { logger } from "../lib/logger";
import { registerWorker, queues } from "../queues/registry";
import {
  listCompetitors,
  getLatestPricingBaseline,
  createPricingBaseline,
  createPricingDiff,
  createSignal,
  type PricingSignificance,
} from "../db/queries";

const SERVICE_NAME = "pricing";
const SOURCE = "pricing" as const;

// Mandatory pattern per .claude/skills/signal-scraping/SKILL.md — pricing
// pages are JS-rendered/anti-bot, Cheerio can't see the real content.
//
// The skill doc's snippet calls `page.setUserAgent(...)`, but that method
// doesn't exist on Playwright's real `Page` type (installed playwright@1.63,
// checked against node_modules/playwright-core/types/types.d.ts) — it's a
// Puppeteer-ism. `setExtraHTTPHeaders({ "User-Agent": ... })` is Playwright's
// actual equivalent and keeps the rest of the mandated shape (single
// `browser.newPage()`, not a `newContext()` restructure) intact.
async function scrapePricingPage(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 (compatible; Signal/1.0; +https://signal.app)",
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    return await page.evaluate(() => {
      // @ts-expect-error — runs inside the browser page, not Node; `document` is a
      // DOM global this project's Node-only tsconfig lib (ES2022, no "dom") doesn't declare.
      return document.body.innerText;
    });
  } finally {
    await browser.close(); // ALWAYS in finally — non-negotiable
  }
}

// ponytail: line-set difference, not a real LCS/Myers diff — no diff library
// is installed (checked package.json) and this is deliberately the minimum
// that works. It can't represent an in-place edit (a changed line shows up
// as one remove + one add) or line moves/reorders. Upgrade to a real diff
// library (e.g. `diff`) only if pricing_diffs ever needs to render a
// human-readable line-level diff view — the significance heuristic below
// doesn't need that precision.
function computeLineDiff(oldText: string, newText: string): { added: string[]; removed: string[] } {
  const oldLines = new Set(
    oldText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  );
  const newLines = new Set(
    newText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  );
  const added = [...newLines].filter((l) => !oldLines.has(l));
  const removed = [...oldLines].filter((l) => !newLines.has(l));
  return { added, removed };
}

const PRICE_PATTERN = /\$\d/;

// Deterministic significance heuristic — no LLM (project-wide rule:
// routing/detection decisions are boolean logic, not model calls, matching
// PatternDetector's SQL-only phase-1 pattern). No upstream spec gives exact
// thresholds, so this is the implementer's call: two signals combine —
// (1) does any changed line look like a price (`$` followed by a digit),
// and (2) what fraction of the larger snapshot's lines changed. A price
// line changing at all is inherently notable (moderate+); a price change
// alongside a broad rewrite, or an outsized rewrite on its own (half the
// page or more), escalates to critical.
function classifySignificance(
  diff: { added: string[]; removed: string[] },
  oldLineCount: number,
  newLineCount: number
): PricingSignificance {
  const changedLines = diff.added.length + diff.removed.length;
  const totalLines = Math.max(oldLineCount, newLineCount, 1);
  const changeRatio = changedLines / totalLines;
  const priceChanged = [...diff.added, ...diff.removed].some((l) => PRICE_PATTERN.test(l));

  if ((priceChanged && changeRatio >= 0.1) || changeRatio >= 0.5) return "critical";
  if (priceChanged || changeRatio >= 0.1) return "moderate";
  return "minor";
}

function summarizeDiff(diff: { added: string[]; removed: string[] }, significance: PricingSignificance): string {
  const lines = [
    `Pricing page changed (${significance}): +${diff.added.length} / -${diff.removed.length} line(s).`,
  ];
  if (diff.added.length) lines.push(`Added: ${diff.added.slice(0, 5).join(" | ")}`);
  if (diff.removed.length) lines.push(`Removed: ${diff.removed.slice(0, 5).join(" | ")}`);
  return lines.join("\n");
}

async function collectForCompetitor(competitor: {
  id: string;
  pricing_url: string;
}): Promise<void> {
  const scrapedText = await withRetry(() => scrapePricingPage(competitor.pricing_url));

  const previousBaseline = await getLatestPricingBaseline(competitor.id);

  const newBaseline = await createPricingBaseline({
    competitor_id: competitor.id,
    snapshot: { raw_text: scrapedText },
  });

  // First-ever scrape for this competitor — nothing to diff against, stop here.
  if (!previousBaseline) return;

  const oldText =
    typeof previousBaseline.snapshot?.raw_text === "string"
      ? (previousBaseline.snapshot.raw_text as string)
      : "";

  const oldLines = oldText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const newLines = scrapedText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const diff = computeLineDiff(oldText, scrapedText);
  const significance = classifySignificance(diff, oldLines.length, newLines.length);

  await createPricingDiff({
    competitor_id: competitor.id,
    baseline_id: newBaseline.id,
    diff: { added: diff.added, removed: diff.removed },
    significance,
  });

  // No dedup check here (unlike the other collectors' signalExistsBySourceUrl
  // gate) — the same pricing_url recurs every scrape by design, but a
  // detected diff is a new event each time, not a duplicate of a prior one.
  const signal = await createSignal({
    competitor_id: competitor.id,
    source: SOURCE,
    source_url: competitor.pricing_url,
    title: `Pricing change detected (${significance})`,
    raw_text: summarizeDiff(diff, significance),
  });

  await queues["pipeline-entity-extraction"].add("extract-entities", { signal_id: signal.id });
}

interface PricingCollectJobData {
  // No fields needed — every run sweeps all active competitors.
}

async function recordCircuitFailure(err: unknown): Promise<void> {
  try {
    await recordFailure(SERVICE_NAME, err instanceof Error ? err.message : String(err));
  } catch (recordErr) {
    // recordFailure makes unguarded Redis calls that can themselves throw —
    // never let that mask the real error below.
    logger.error("Failed to record circuit-breaker failure for pricing", { error: recordErr });
  }
}

export async function pricingCollectorProcessor(_job: Job<PricingCollectJobData>): Promise<void> {
  // Playwright itself must not even launch when disabled — this is a whole-run
  // no-op, not a per-competitor skip.
  if (process.env.ENABLE_PLAYWRIGHT === "false") {
    logger.info("pricing collector skipped — ENABLE_PLAYWRIGHT is false");
    return;
  }

  if (await isCircuitOpen(SERVICE_NAME)) {
    throw new Error(`${SERVICE_NAME} circuit is open — skipping job`);
  }

  try {
    const competitors = (await listCompetitors()).filter((c) => c.is_active && c.pricing_url);

    // Same per-competitor isolation as hn.ts/jobs.ts — one competitor's
    // pricing page failing (after withRetry exhausts its attempts) must not
    // abort collection for every other competitor in this run.
    let hadFailure = false;
    for (const competitor of competitors) {
      try {
        await collectForCompetitor({ id: competitor.id, pricing_url: competitor.pricing_url as string });
      } catch (err) {
        hadFailure = true;
        logger.error("pricing collector failed for one competitor — continuing with the rest", {
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
export function initPricingWorker() {
  return registerWorker("collect-pricing", pricingCollectorProcessor);
}
