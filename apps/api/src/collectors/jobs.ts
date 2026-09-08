// BullMQ collector — pulls new job postings from Greenhouse/Lever every 24h, delta-only against baseline.
//
// Greenhouse and Lever are two independent external services — a per-company
// board can have a greenhouse_token, a lever_token, both, or neither. Each
// service gets its own circuit breaker ("greenhouse" / "lever") so one
// service's outage never blocks the other, for the same competitor or any
// other. "Delta-only against baseline" (module header) is just the standard
// dedup-by-source_url check against `signals`, same as reddit.ts/hn.ts — no
// separate baseline table (rejected in docs/decisions.md, 2026-08-27).
//
// Neither API supports a "since" query param, so there's no watermark to
// track (unlike reddit.ts/hn.ts) — every run re-fetches each board's full
// current listing and relies entirely on signalExistsBySourceUrl for dedup.
import type { Job } from "bullmq";
import { withRetry } from "../lib/retry";
import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { logger } from "../lib/logger";
import { registerWorker, queues } from "../queues/registry";
import { listCompetitors, signalExistsBySourceUrl, createSignal } from "../db/queries";

const SOURCE = "jobs" as const;
const GREENHOUSE_SERVICE = "greenhouse";
const LEVER_SERVICE = "lever";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  content?: string;
}

interface GreenhouseJobsResponse {
  jobs: GreenhouseJob[];
}

// Verified against github.com/lever/postings-api (README.md, master) plus
// independent third-party documentation (fantastic.jobs, atsfeeds.com,
// parse.bot) — no snippet existed in the skill doc for this one.
interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  descriptionPlain?: string;
}

async function fetchGreenhouseJobs(token: string): Promise<GreenhouseJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Greenhouse API returned ${response.status} for board "${token}"`);
  }
  const data = (await response.json()) as GreenhouseJobsResponse;
  return data.jobs ?? [];
}

async function fetchLeverPostings(site: string): Promise<LeverPosting[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Lever API returned ${response.status} for site "${site}"`);
  }
  const data = (await response.json()) as LeverPosting[];
  return data ?? [];
}

async function collectGreenhouse(competitor: { id: string; greenhouse_token: string }): Promise<void> {
  const jobs = await withRetry(() => fetchGreenhouseJobs(competitor.greenhouse_token));

  for (const job of jobs) {
    const sourceUrl = job.absolute_url;
    if (!sourceUrl) continue;

    const alreadyCollected = await signalExistsBySourceUrl(competitor.id, SOURCE, sourceUrl);
    if (alreadyCollected) continue;

    const signal = await createSignal({
      competitor_id: competitor.id,
      source: SOURCE,
      source_url: sourceUrl,
      title: job.title ?? null,
      raw_text: job.content || job.title || "",
    });

    await queues["pipeline-entity-extraction"].add("extract-entities", { signal_id: signal.id });
  }
}

async function collectLever(competitor: { id: string; lever_token: string }): Promise<void> {
  const postings = await withRetry(() => fetchLeverPostings(competitor.lever_token));

  for (const posting of postings) {
    const sourceUrl = posting.hostedUrl;
    if (!sourceUrl) continue;

    const alreadyCollected = await signalExistsBySourceUrl(competitor.id, SOURCE, sourceUrl);
    if (alreadyCollected) continue;

    const signal = await createSignal({
      competitor_id: competitor.id,
      source: SOURCE,
      source_url: sourceUrl,
      title: posting.text ?? null,
      raw_text: posting.descriptionPlain || posting.text || "",
    });

    await queues["pipeline-entity-extraction"].add("extract-entities", { signal_id: signal.id });
  }
}

interface JobsCollectJobData {
  // No fields needed — every run sweeps all active competitors.
}

async function recordCircuitFailure(service: string, err: unknown): Promise<void> {
  try {
    await recordFailure(service, err instanceof Error ? err.message : String(err));
  } catch (recordErr) {
    // recordFailure makes unguarded Redis calls that can themselves throw —
    // never let that mask the real error below.
    logger.error(`Failed to record circuit-breaker failure for ${service}`, { error: recordErr });
  }
}

export async function jobsCollectorProcessor(_job: Job<JobsCollectJobData>): Promise<void> {
  const [greenhouseOpen, leverOpen] = await Promise.all([
    isCircuitOpen(GREENHOUSE_SERVICE),
    isCircuitOpen(LEVER_SERVICE),
  ]);

  // Only skip the whole job when there's genuinely nothing left to do — one
  // service's circuit being open must not stop the other from collecting.
  if (greenhouseOpen && leverOpen) {
    throw new Error("greenhouse and lever circuits are both open — skipping job");
  }

  let competitors: Awaited<ReturnType<typeof listCompetitors>>;
  try {
    competitors = (await listCompetitors()).filter((c) => c.is_active);
  } catch (err) {
    // Not attributable to either external service, but this run produced no
    // work for either — surface it against both circuits, same spirit as
    // reddit.ts/hn.ts treating a listCompetitors() failure as a job failure.
    await recordCircuitFailure(GREENHOUSE_SERVICE, err);
    await recordCircuitFailure(LEVER_SERVICE, err);
    throw err;
  }

  // Two isolation axes: per competitor (one competitor's board outage must
  // not stop the next competitor's), and per service within a competitor
  // (that same competitor's Lever collection must still run even if their
  // Greenhouse board just failed, and vice versa).
  let greenhouseAttempted = false;
  let greenhouseHadFailure = false;
  let leverAttempted = false;
  let leverHadFailure = false;

  for (const competitor of competitors) {
    if (competitor.greenhouse_token && !greenhouseOpen) {
      greenhouseAttempted = true;
      try {
        await collectGreenhouse({ id: competitor.id, greenhouse_token: competitor.greenhouse_token });
      } catch (err) {
        greenhouseHadFailure = true;
        logger.error("jobs collector failed to collect Greenhouse postings for one competitor — continuing", {
          competitor_id: competitor.id,
          competitor_name: competitor.name,
          error: err instanceof Error ? err.message : String(err),
        });
        await recordCircuitFailure(GREENHOUSE_SERVICE, err);
      }
    }

    if (competitor.lever_token && !leverOpen) {
      leverAttempted = true;
      try {
        await collectLever({ id: competitor.id, lever_token: competitor.lever_token });
      } catch (err) {
        leverHadFailure = true;
        logger.error("jobs collector failed to collect Lever postings for one competitor — continuing", {
          competitor_id: competitor.id,
          competitor_name: competitor.name,
          error: err instanceof Error ? err.message : String(err),
        });
        await recordCircuitFailure(LEVER_SERVICE, err);
      }
    }
  }

  // recordSuccess only fires for a service that actually ran clean this
  // pass — a service nobody had a token for this run stays silent rather
  // than claiming a success it didn't earn.
  if (greenhouseAttempted && !greenhouseHadFailure) {
    await recordSuccess(GREENHOUSE_SERVICE);
  }
  if (leverAttempted && !leverHadFailure) {
    await recordSuccess(LEVER_SERVICE);
  }
}

// Extension point — must only be called from the standalone worker process
// entrypoint (not built yet), same as registry.ts's initWorkers(). Not
// called here so importing this module never starts a live Worker as a
// side effect.
export function initJobsWorker() {
  return registerWorker("collect-jobs", jobsCollectorProcessor);
}
