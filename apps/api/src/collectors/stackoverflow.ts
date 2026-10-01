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

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

async function fetchQuestions(tag: string): Promise<unknown> {
  const url = `https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&tagged=${encodeURIComponent(tag)}&site=stackoverflow&pagesize=20&filter=withbody`;
  return withRetry(
    async () => {
      const res = await safeFetch(url, { signal: AbortSignal.timeout(30_000), maxBytes: 2_000_000 });
      if (res.status === 400) throw new ConfigError(`stackexchange rejected tag ${tag}`);
      if (res.status < 200 || res.status >= 300) throw new Error(`${url} returned ${res.status}`);
      return res.json();
    },
    { shouldRetry: (err: unknown) => !(err instanceof ConfigError) }
  );
}

async function collectStackoverflow(competitor: Competitor, tag: string): Promise<void> {
  let body: unknown;
  try {
    body = await fetchQuestions(tag);
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
  if (!isRecord(body)) return;
  if (body.backoff !== undefined) {
    logger.warn("stackexchange asked us to back off", { backoff: body.backoff, tag });
  }
  if (!Array.isArray(body.items)) return;

  for (const item of body.items) {
    try {
      if (!isRecord(item) || typeof item.title !== "string" || typeof item.link !== "string") continue;
      if (!item.link.startsWith("https://stackoverflow.com/")) continue;
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
  return runSourceSweep<string>(SERVICE, (c) => c.stackoverflow_tag || null, collectStackoverflow);
}

export function initStackoverflowWorker() {
  return registerWorker("collect-stackoverflow", stackoverflowCollectorProcessor);
}
