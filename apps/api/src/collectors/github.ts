// BullMQ collector — reads a competitor's public GitHub org every 6h.
//
// This is the lead-time source. A changelog entry or launch post describes a
// change after it shipped; a release tag, an open pull request title, or a
// brand-new repository under the org is the change itself, timestamped, often
// weeks earlier. Three artifact types, chosen because each answers a different
// question and none of them are reconstructable from the others:
//
//   releases  — what actually shipped, and at what cadence
//   pulls     — what is being built right now (the genuine leading indicator)
//   repos     — a new product line appearing before anyone announces it
//
// Deliberately NOT collected: individual commits. Volume is enormous, the
// signal-to-noise is the worst of any GitHub artifact, and anything a commit
// stream would reveal about direction shows up in a PR title first.
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
import { safeFetch } from "../lib/safe-fetch";

const SERVICE_NAME = "github";
const SOURCE = "github" as const;

const API_ROOT = "https://api.github.com";
const MAX_GITHUB_BYTES = 5_000_000;
const REQUEST_TIMEOUT_MS = 30_000;

// Repositories per org, most-recently-pushed first. Only these are walked for
// releases and pull requests — an org like `microsoft` has thousands of repos
// and almost all of them are dormant.
const MAX_REPOS_PER_ORG = 15;
const MAX_RELEASES_PER_REPO = 10;
const MAX_PULLS_PER_REPO = 25;

// A repo nobody has pushed to in three months is not telling us anything about
// what the competitor is building now.
const REPO_STALE_AFTER_DAYS = 90;

// How recently a repository must have been created to be reported as new.
// This is a separate gate from the incremental cutoff on purpose: on the first
// run for a competitor there is no cutoff at all, so without an absolute
// recency bound every repo the org has ever published — including ones from
// years ago — would be emitted as "New repository". Those rows would then sit
// in the evidence set as fabricated proof of a product launch that never
// happened, which is exactly the kind of claim the ledger exists to prevent.
const REPO_NEW_WITHIN_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Bodies are free-text and occasionally enormous (release notes that inline a
// full changelog). The pipeline chunks at 400 tokens anyway; this only stops a
// pathological row from reaching it.
const MAX_BODY_CHARS = 20_000;

interface GitHubRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  archived: boolean;
  private: boolean;
  pushed_at: string | null;
  created_at: string | null;
  language: string | null;
  stargazers_count: number;
}

interface GitHubRelease {
  html_url: string;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
}

interface GitHubPull {
  html_url: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
}

// GitHub allows 60 requests/hour unauthenticated and 5,000/hour with a token.
// Unauthenticated is not enough to walk even one org's repos at a 6h cadence,
// so the token is effectively required — but a missing one degrades to a warn
// and a skipped run rather than failing the queue and tripping the breaker on
// what is a configuration problem, not a GitHub outage.
function githubToken(): string | undefined {
  return process.env.GITHUB_TOKEN?.trim() || undefined;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "signal-competitive-intelligence",
  };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Thrown when GitHub reports the rate limit is exhausted. Distinct from a
// generic failure because retrying inside this run cannot help — the limit
// resets on GitHub's clock, not ours — so it aborts the run without counting
// as a circuit-breaker failure.
class GitHubRateLimitError extends Error {
  constructor(readonly resetAt: Date | undefined) {
    super(
      resetAt
        ? `GitHub rate limit exhausted, resets at ${resetAt.toISOString()}`
        : "GitHub rate limit exhausted"
    );
    this.name = "GitHubRateLimitError";
  }
}

function parseResetHeader(headers: Headers): Date | undefined {
  const raw = headers.get("x-ratelimit-reset");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : undefined;
}

async function githubGet<T>(path: string): Promise<T> {
  // No assertPublicUrl: the host is the hardcoded api.github.com constant, not
  // anything derived from competitor-supplied data, so there is no SSRF surface
  // to guard here. safeFetch is still used for its byte cap.
  const response = await safeFetch(`${API_ROOT}${path}`, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    maxBytes: MAX_GITHUB_BYTES,
  });

  // 403 and 429 both carry rate-limit exhaustion; only x-ratelimit-remaining
  // distinguishes it from a genuine permission error on a private resource.
  if (response.status === 429 || response.status === 403) {
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      throw new GitHubRateLimitError(parseResetHeader(response.headers));
    }
  }
  // A competitor's org can be renamed or deleted between runs. That is a
  // configuration fact about one competitor, not a GitHub failure, so it is
  // surfaced as a normal error and isolated by the per-competitor try/catch.
  if (response.status === 404) {
    throw new Error(`GitHub returned 404 for ${path}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub returned ${response.status} for ${path}`);
  }

  return JSON.parse(await response.text()) as T;
}

function truncateBody(body: string | null): string {
  if (!body) return "";
  return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}…` : body;
}

function isNewerThan(timestamp: string | null, cutoff: Date | undefined): boolean {
  if (!cutoff) return true;
  if (!timestamp) return true;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? true : parsed > cutoff;
}

// A repository counts as newly created only if it clears BOTH the incremental
// cutoff (don't re-report what a previous run already saw) and an absolute
// recency bound (don't call a four-year-old repo new just because this is the
// first run). An unparseable or missing created_at fails closed — silence is
// cheaper here than a false launch signal.
function isNewlyCreatedRepo(repo: GitHubRepo, cutoff: Date | undefined, now: Date): boolean {
  if (!repo.created_at) return false;
  const created = new Date(repo.created_at);
  if (Number.isNaN(created.getTime())) return false;
  if (created.getTime() < now.getTime() - REPO_NEW_WITHIN_DAYS * MS_PER_DAY) return false;
  return isNewerThan(repo.created_at, cutoff);
}

// Repos worth walking: sorted most-recently-pushed first by the API, then
// filtered to non-fork, non-archived, and pushed within the staleness window.
// Forks are excluded because their activity reflects the upstream project,
// not this competitor's direction.
async function listActiveRepos(org: string, now: Date): Promise<GitHubRepo[]> {
  const repos = await githubGet<GitHubRepo[]>(
    `/orgs/${encodeURIComponent(org)}/repos?sort=pushed&direction=desc&per_page=${MAX_REPOS_PER_ORG * 2}`
  );
  const staleBefore = now.getTime() - REPO_STALE_AFTER_DAYS * MS_PER_DAY;

  return repos
    .filter((repo) => !repo.fork && !repo.archived && !repo.private)
    .filter((repo) => {
      if (!repo.pushed_at) return false;
      const pushed = new Date(repo.pushed_at);
      return !Number.isNaN(pushed.getTime()) && pushed.getTime() >= staleBefore;
    })
    .slice(0, MAX_REPOS_PER_ORG);
}

interface CollectedArtifact {
  sourceUrl: string;
  title: string;
  rawText: string;
}

function repoArtifact(org: string, repo: GitHubRepo): CollectedArtifact {
  return {
    sourceUrl: repo.html_url,
    title: `New repository: ${repo.full_name}`,
    rawText: [
      `${org} created a new public repository: ${repo.full_name}`,
      repo.description ? `Description: ${repo.description}` : null,
      repo.language ? `Primary language: ${repo.language}` : null,
      `Stars: ${repo.stargazers_count}`,
      repo.created_at ? `Created at: ${repo.created_at}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function releaseArtifact(repo: GitHubRepo, release: GitHubRelease): CollectedArtifact {
  const label = release.name?.trim() || release.tag_name;
  return {
    sourceUrl: release.html_url,
    title: `${repo.full_name} release: ${label}`,
    rawText: [
      `Repository: ${repo.full_name}`,
      `Release: ${label} (tag ${release.tag_name})`,
      release.prerelease ? "Marked as a prerelease." : null,
      release.published_at ? `Published at: ${release.published_at}` : null,
      "",
      truncateBody(release.body),
    ]
      .filter((line) => line !== null)
      .join("\n")
      .trim(),
  };
}

function pullArtifact(repo: GitHubRepo, pull: GitHubPull): CollectedArtifact {
  const status = pull.merged_at ? "merged" : pull.state;
  return {
    sourceUrl: pull.html_url,
    title: `${repo.full_name} PR #${pull.number}: ${pull.title}`,
    rawText: [
      `Repository: ${repo.full_name}`,
      `Pull request #${pull.number}: ${pull.title}`,
      `State: ${status}${pull.draft ? " (draft)" : ""}`,
      `Opened at: ${pull.created_at}`,
      pull.merged_at ? `Merged at: ${pull.merged_at}` : null,
      "",
      truncateBody(pull.body),
    ]
      .filter((line) => line !== null)
      .join("\n")
      .trim(),
  };
}

async function gatherArtifacts(
  org: string,
  cutoff: Date | undefined,
  now: Date
): Promise<CollectedArtifact[]> {
  const repos = await withRetry(() => listActiveRepos(org, now));
  const artifacts: CollectedArtifact[] = [];

  for (const repo of repos) {
    // A genuinely new repository is itself the signal — a new product line
    // becomes visible here before it has a release, a blog post, or a
    // changelog entry.
    if (isNewlyCreatedRepo(repo, cutoff, now)) {
      artifacts.push(repoArtifact(org, repo));
    }

    // One repo's releases or pulls failing must not cost us the other repos in
    // this org — same per-item isolation the other collectors apply.
    try {
      const releases = await withRetry(() =>
        githubGet<GitHubRelease[]>(
          `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo.name)}/releases?per_page=${MAX_RELEASES_PER_REPO}`
        )
      );
      for (const release of releases) {
        if (release.draft) continue;
        if (!isNewerThan(release.published_at, cutoff)) continue;
        artifacts.push(releaseArtifact(repo, release));
      }
    } catch (err) {
      if (err instanceof GitHubRateLimitError) throw err;
      logger.error("github collector failed to read releases for one repo — continuing", {
        org,
        repo: repo.full_name,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const pulls = await withRetry(() =>
        githubGet<GitHubPull[]>(
          `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo.name)}/pulls?state=all&sort=updated&direction=desc&per_page=${MAX_PULLS_PER_REPO}`
        )
      );
      for (const pull of pulls) {
        // updated_at, not created_at: a long-lived PR that just got activity is
        // current evidence of direction even though it was opened months ago.
        if (!isNewerThan(pull.updated_at, cutoff)) continue;
        artifacts.push(pullArtifact(repo, pull));
      }
    } catch (err) {
      if (err instanceof GitHubRateLimitError) throw err;
      logger.error("github collector failed to read pulls for one repo — continuing", {
        org,
        repo: repo.full_name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return artifacts;
}

async function collectForCompetitor(
  competitor: { id: string; name: string; github_org: string },
  now: Date
): Promise<void> {
  const lastCollectedAt = await getLatestSignalCollectedAt(competitor.id, SOURCE);
  const artifacts = await gatherArtifacts(competitor.github_org, lastCollectedAt, now);

  for (const artifact of artifacts) {
    // One artifact throwing (dedup check, insert, or pipeline enqueue) must not
    // abort the rest of this competitor's batch.
    try {
      const alreadyCollected = await signalExistsBySourceUrl(
        competitor.id,
        SOURCE,
        artifact.sourceUrl
      );
      if (alreadyCollected) continue;
      if (!artifact.rawText) continue;

      const signal = await createSignal({
        competitor_id: competitor.id,
        source: SOURCE,
        source_url: artifact.sourceUrl,
        title: artifact.title,
        raw_text: artifact.rawText,
      });

      await enqueueInitialSignalPipeline(signal.id);
    } catch (err) {
      logger.error("github collector failed to process one artifact — continuing with the rest", {
        competitor_id: competitor.id,
        competitor_name: competitor.name,
        source_url: artifact.sourceUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

interface GithubCollectJobData {
  // No fields needed — every run sweeps all active competitors with a github_org.
}

async function recordCircuitFailure(err: unknown): Promise<void> {
  try {
    await recordFailure(SERVICE_NAME, err instanceof Error ? err.message : String(err));
  } catch (recordErr) {
    // recordFailure makes unguarded Redis calls that can themselves throw —
    // never let that mask the real error below.
    logger.error("Failed to record circuit-breaker failure for github", { error: recordErr });
  }
}

export async function githubCollectorProcessor(_job: Job<GithubCollectJobData>): Promise<void> {
  if (await isCircuitOpen(SERVICE_NAME)) {
    throw new Error(`${SERVICE_NAME} circuit is open — skipping job`);
  }

  if (!githubToken()) {
    // Not a throw: an unset token is a deployment gap, and failing the job would
    // trip the breaker against GitHub, which is working fine.
    logger.warn("GITHUB_TOKEN is not set — skipping github collection", {
      hint: "60 req/hour unauthenticated is below what one org sweep needs",
    });
    return;
  }

  const now = new Date();

  try {
    const competitors = (await listCompetitors()).filter(
      (c): c is typeof c & { github_org: string } => c.is_active && Boolean(c.github_org)
    );

    let hadFailure = false;
    // Set when the loop exits early rather than by running out of competitors —
    // that is not a clean run, so it must not let the trailing recordSuccess()
    // force-close a circuit that was correctly observed open.
    let stoppedEarly = false;

    for (const competitor of competitors) {
      // The breaker can trip mid-run off an earlier competitor's failures —
      // re-check before every attempt so the remaining competitors don't each
      // still pay the full withRetry cost against a dependency just confirmed
      // to be down.
      if (await isCircuitOpen(SERVICE_NAME)) {
        stoppedEarly = true;
        logger.warn("github circuit opened mid-run — stopping before remaining competitors", {
          competitor_id: competitor.id,
          competitor_name: competitor.name,
        });
        break;
      }

      try {
        await collectForCompetitor(competitor, now);
      } catch (err) {
        if (err instanceof GitHubRateLimitError) {
          // Every remaining competitor would hit the same wall. Stop the run
          // without recording a failure: the limit is a quota we exceeded, not
          // GitHub being unhealthy, and opening the breaker on it would keep us
          // off GitHub well past the reset.
          stoppedEarly = true;
          logger.warn("github rate limit exhausted — ending run early", {
            competitor_id: competitor.id,
            resets_at: err.resetAt?.toISOString(),
          });
          break;
        }
        hadFailure = true;
        logger.error("github collector failed for one competitor — continuing with the rest", {
          competitor_id: competitor.id,
          competitor_name: competitor.name,
          error: err instanceof Error ? err.message : String(err),
        });
        await recordCircuitFailure(err);
      }
    }

    if (!hadFailure && !stoppedEarly) {
      await recordSuccess(SERVICE_NAME);
    }
  } catch (err) {
    // Failure outside the per-competitor loop (e.g. listCompetitors() itself) —
    // a real job-level failure, so this one still rethrows.
    await recordCircuitFailure(err);
    throw err;
  }
}

// Extension point — only called from the standalone worker entrypoint, so
// importing this module never starts a live Worker as a side effect.
export function initGithubWorker() {
  return registerWorker("collect-github", githubCollectorProcessor);
}

// Exported for the discovery agent and tests.
export { GitHubRateLimitError, githubGet, listActiveRepos };
