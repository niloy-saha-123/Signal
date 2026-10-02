// BullMQ collector — new Stack Overflow questions on the competitor's tag
// (source "community"), every 12h. Keyless Stack Exchange API.
import type { Job } from "bullmq";
import * as cheerio from "cheerio";
import { withRetry } from "../lib/retry";
import { safeFetch } from "../lib/safe-fetch";
import { logger } from "../lib/logger";
import { extractHtmlText } from "../lib/html-text";
import { registerWorker } from "../queues/registry";
import { enqueueInitialSignalPipeline } from "../pipeline/recovery";
import { createSignal, signalExistsBySourceUrl, type Competitor } from "../db/queries";
import { runSourceSweep, ConfigError } from "./sweep";

const SERVICE = "stackoverflow";
const SOURCE = "community" as const;
const MAX_BACKOFF_SECONDS = 60;
const MIN_QUOTA = 10;
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// Indirection so tests can observe backoff waits without real timers.
export const timing = {
  sleep: (seconds: number) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)),
};

// A Stack Exchange answer that applies to every later request this run
// (throttle, quota): never retried, and it stops the rest of the sweep.
class StackExchangeHalt extends Error {}

// One processor run's shared Stack Exchange state.
interface Run {
  bodies: Map<string, Promise<unknown>>;
  waitSeconds: number;
  halted: Error | null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

async function fetchQuestions(tag: string): Promise<unknown> {
  const key = process.env.STACKEXCHANGE_KEY?.trim();
  const url = `https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&tagged=${encodeURIComponent(tag)}&site=stackoverflow&pagesize=20&filter=withbody${key ? `&key=${encodeURIComponent(key)}` : ""}`;
  return withRetry(
    async () => {
      const res = await safeFetch(url, { signal: AbortSignal.timeout(30_000), maxBytes: 2_000_000 });
      if (res.status === 400) {
        // Stack Exchange reports throttling as HTTP 400 too; only bad_parameter is the tag's fault.
        const errBody = await res.json().catch(() => null);
        const errorId = isRecord(errBody) ? errBody.error_id : undefined;
        if (errorId === 400) throw new ConfigError(`stackexchange rejected tag ${tag}`);
        throw new StackExchangeHalt(`stackexchange returned 400 with error_id ${String(errorId)}`);
      }
      // Not the URL: it may carry the API key.
      if (res.status < 200 || res.status >= 300) throw new Error(`stackexchange returned ${res.status}`);
      return res.json();
    },
    { shouldRetry: (err: unknown) => !(err instanceof ConfigError || err instanceof StackExchangeHalt) }
  );
}

function fetchForRun(run: Run, tag: string): Promise<unknown> {
  // Several workspaces can track the same competitor: one request per tag per run.
  let pending = run.bodies.get(tag);
  if (!pending) {
    pending = (async () => {
      if (run.halted) throw run.halted;
      if (run.waitSeconds > 0) {
        await timing.sleep(run.waitSeconds);
        run.waitSeconds = 0;
      }
      let body: unknown;
      try {
        body = await fetchQuestions(tag);
      } catch (err) {
        if (err instanceof StackExchangeHalt) run.halted = err;
        throw err;
      }
      if (isRecord(body)) {
        if (typeof body.backoff === "number") {
          logger.warn("stackexchange asked us to back off", { backoff: body.backoff, tag });
          run.waitSeconds = Math.min(body.backoff, MAX_BACKOFF_SECONDS);
        }
        if (typeof body.quota_remaining === "number" && body.quota_remaining < MIN_QUOTA) {
          run.halted = new StackExchangeHalt(`stackexchange quota nearly spent (${body.quota_remaining} left)`);
        }
      }
      return body;
    })();
    run.bodies.set(tag, pending);
  }
  return pending;
}

async function collectStackoverflow(competitor: Competitor, tag: string, run: Run): Promise<void> {
  let body: unknown;
  try {
    body = await fetchForRun(run, tag);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.warn("stackoverflow tag rejected — check the competitor's tag", {
        competitor_id: competitor.id,
        tag,
        reason: err.message,
      });
      return;
    }
    throw err;
  }
  if (!isRecord(body) || !Array.isArray(body.items)) return;
  const minCreated = Date.now() / 1000 - MAX_AGE_SECONDS;

  for (const item of body.items) {
    try {
      if (!isRecord(item) || typeof item.title !== "string" || typeof item.link !== "string") continue;
      if (!item.link.startsWith("https://stackoverflow.com/")) continue;
      if (typeof item.creation_date !== "number" || item.creation_date < minCreated) continue;
      if (await signalExistsBySourceUrl(competitor.id, SOURCE, item.link)) continue;
      const title = cheerio.load(item.title).text();
      const bodyText = typeof item.body === "string" ? extractHtmlText(item.body) : "";
      const score = typeof item.score === "number" ? item.score : 0;
      const answers = typeof item.answer_count === "number" ? item.answer_count : 0;
      const signal = await createSignal({
        competitor_id: competitor.id,
        source: SOURCE,
        source_url: item.link,
        title: title.slice(0, 300),
        raw_text: `Stack Overflow question tagged [${tag}] (score ${score}, ${answers} answers): ${title}\n\n${bodyText}`.slice(0, 12_000),
      });
      if (!signal) continue;
      try {
        await enqueueInitialSignalPipeline(signal.id);
      } catch (err) {
        // The signal row (and its outbox entry) is committed; pipeline recovery re-enqueues it.
        logger.error("stackoverflow signal enqueue failed — left for pipeline recovery", {
          signal_id: signal.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      logger.error("stackoverflow question failed — continuing with the rest", {
        competitor_id: competitor.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function stackoverflowCollectorProcessor(_job: Job): Promise<void> {
  const run: Run = { bodies: new Map(), waitSeconds: 0, halted: null };
  return runSourceSweep<string>(SERVICE, (c) => c.stackoverflow_tag || null, (c, tag) =>
    collectStackoverflow(c, tag, run)
  );
}

export function initStackoverflowWorker() {
  return registerWorker("collect-stackoverflow", stackoverflowCollectorProcessor);
}
