// BullMQ collector — reads a competitor's own public community, every 12h.
//
// Distinct from the reddit collector on purpose. Reddit is a third-party venue
// the company does not control; its own forum is where support load, migration
// complaints and roadmap pressure accumulate in front of its own staff. A
// thread a company cannot moderate away is a different class of evidence from a
// thread on somebody else's platform.
//
// Surface: Discourse's /latest.json on any public instance — free, no API key.
//
// Deliberately not collected: Discord and Slack communities. Both require a bot
// invited into a private workspace, which is not public evidence and not
// something this product should be asking competitors' communities to grant.
import type { Job } from "bullmq";
import { withRetry } from "../lib/retry";
import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { logger } from "../lib/logger";
import { registerWorker } from "../queues/registry";
import { enqueueInitialSignalPipeline } from "../pipeline/recovery";
import {
  listCompetitors,
  getLatestSignalCollectedAt,
  signalExistsBySourceUrl,
  createSignal,
} from "../db/queries";
import { assertPublicUrl, safeFetch } from "../lib/safe-fetch";

const SERVICE_NAME = "community";
const SOURCE = "community" as const;

const MAX_BYTES = 3_000_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOPICS = 30;

interface DiscourseTopic {
  id: number;
  title: string;
  slug: string;
  posts_count: number;
  reply_count: number;
  views: number;
  created_at: string;
  excerpt?: string;
}

interface DiscourseLatest {
  topic_list?: { topics?: DiscourseTopic[] };
}

function isNewerThan(timestamp: string, cutoff: Date | undefined): boolean {
  if (!cutoff) return true;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? true : parsed > cutoff;
}

async function fetchDiscourseTopics(baseUrl: string): Promise<DiscourseTopic[]> {
  const url = new URL("/latest.json", baseUrl).toString();
  // Competitor-supplied host, so this one genuinely needs the SSRF guard.
  await assertPublicUrl(url);
  const response = await safeFetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    maxBytes: MAX_BYTES,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Discourse ${url} returned ${response.status}`);
  }
  const parsed = JSON.parse(await response.text()) as DiscourseLatest;
  return (parsed.topic_list?.topics ?? []).slice(0, MAX_TOPICS);
}

async function collectDiscourse(
  competitor: { id: string; name: string; discourse_url: string },
  cutoff: Date | undefined
): Promise<void> {
  const topics = await withRetry(() => fetchDiscourseTopics(competitor.discourse_url));

  for (const topic of topics) {
    try {
      if (!isNewerThan(topic.created_at, cutoff)) continue;

      const topicUrl = new URL(`/t/${topic.slug}/${topic.id}`, competitor.discourse_url).toString();
      if (await signalExistsBySourceUrl(competitor.id, SOURCE, topicUrl)) continue;

      const body = [
        `Community thread on ${competitor.name}'s own forum: ${topic.title}`,
        topic.excerpt ? `\n${topic.excerpt}` : "",
        `\nReplies: ${topic.reply_count} · Views: ${topic.views} · Posts: ${topic.posts_count}`,
      ].join("");

      const signal = await createSignal({
        competitor_id: competitor.id,
        source: SOURCE,
        source_url: topicUrl,
        title: topic.title,
        raw_text: body,
      });
      await enqueueInitialSignalPipeline(signal.id);
    } catch (err) {
      logger.error("community collector failed on one topic — continuing", {
        competitor_id: competitor.id,
        topic_id: topic.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

interface CommunityCollectJobData {
  // No fields — every run sweeps all active competitors with a community URL.
}

async function recordCircuitFailure(err: unknown): Promise<void> {
  try {
    await recordFailure(SERVICE_NAME, err instanceof Error ? err.message : String(err));
  } catch (recordErr) {
    logger.error("Failed to record circuit-breaker failure for community", { error: recordErr });
  }
}

export async function communityCollectorProcessor(
  _job: Job<CommunityCollectJobData>
): Promise<void> {
  if (await isCircuitOpen(SERVICE_NAME)) {
    throw new Error(`${SERVICE_NAME} circuit is open — skipping job`);
  }

  try {
    const competitors = (await listCompetitors()).filter(
      (c): c is typeof c & { discourse_url: string } => c.is_active && Boolean(c.discourse_url)
    );

    let hadFailure = false;
    let stoppedEarly = false;

    for (const competitor of competitors) {
      if (await isCircuitOpen(SERVICE_NAME)) {
        stoppedEarly = true;
        logger.warn("community circuit opened mid-run — stopping", {
          competitor_id: competitor.id,
        });
        break;
      }
      try {
        const cutoff = await getLatestSignalCollectedAt(competitor.id, SOURCE);
        await collectDiscourse(competitor, cutoff);
      } catch (err) {
        hadFailure = true;
        logger.error("community collector failed for one competitor — continuing", {
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

export function initCommunityWorker() {
  return registerWorker("collect-community", communityCollectorProcessor);
}
