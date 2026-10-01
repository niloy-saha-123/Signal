// BullMQ collector — new npm / PyPI releases of the competitor's packages, every 12h.
//
// A release is first-party fact with a timestamp. Release notes live on
// GitHub (the github collector); this source catches the publish itself,
// including SDKs whose repos are private.
//
// npm: only the small dist-tags document is read — the full packument can be
// tens of MB for a popular package. PyPI: the per-project releases RSS.
import type { Job } from "bullmq";
import Parser from "rss-parser";
import { withRetry } from "../lib/retry";
import { safeFetch } from "../lib/safe-fetch";
import { logger } from "../lib/logger";
import { registerWorker } from "../queues/registry";
import { enqueueInitialSignalPipeline } from "../pipeline/recovery";
import {
  createSignal,
  getLatestSignalCollectedAt,
  signalExistsBySourceUrl,
  type Competitor,
} from "../db/queries";
import { runSourceSweep } from "./sweep";

const SOURCE = "packages" as const;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BYTES = 1_000_000;
const MAX_PYPI_RELEASES_PER_RUN = 10;
// Registry text goes into a URL we store and render; hold it to version shape.
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

interface PackageConfig {
  npm: string[];
  pypi: string[];
}

class PackageNotFoundError extends Error {}

const parser = new Parser();

async function registryGet(url: string) {
  const res = await safeFetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    maxBytes: MAX_BYTES,
  });
  if (res.status === 404) throw new PackageNotFoundError(`${url} returned 404`);
  if (res.status < 200 || res.status >= 300) throw new Error(`${url} returned ${res.status}`);
  return res;
}

const noRetryOn404 = { shouldRetry: (err: unknown) => !(err instanceof PackageNotFoundError) };

async function emit(competitorId: string, sourceUrl: string, title: string, rawText: string) {
  const signal = await createSignal({
    competitor_id: competitorId,
    source: SOURCE,
    source_url: sourceUrl,
    title,
    raw_text: rawText,
  });
  try {
    await enqueueInitialSignalPipeline(signal.id);
  } catch (err) {
    // The signal row (and its outbox entry) is committed; pipeline recovery
    // re-enqueues it, so this must not fail the package.
    logger.error("packages signal enqueue failed — left for pipeline recovery", {
      signal_id: signal.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function collectNpm(competitor: Competitor, name: string): Promise<void> {
  const url = `https://registry.npmjs.org/-/package/${name.replace("/", "%2F")}/dist-tags`;
  const body: unknown = await withRetry(async () => (await registryGet(url)).json(), noRetryOn404);
  const latest = body && typeof body === "object" && "latest" in body ? body.latest : undefined;
  if (typeof latest !== "string" || !VERSION.test(latest)) {
    // Retrying won't change the registry's data — treat it like a 404.
    throw new PackageNotFoundError(`npm ${name} has no usable latest dist-tag`);
  }
  const sourceUrl = `https://www.npmjs.com/package/${name}/v/${latest}`;
  if (await signalExistsBySourceUrl(competitor.id, SOURCE, sourceUrl)) return;
  await emit(competitor.id, sourceUrl, `${name} ${latest}`, `${name} ${latest} was published to npm.`);
}

async function collectPypi(
  competitor: Competitor,
  name: string,
  since: Date | undefined
): Promise<void> {
  const url = `https://pypi.org/rss/project/${encodeURIComponent(name)}/releases.xml`;
  const feed = await withRetry(
    async () => parser.parseString(await (await registryGet(url)).text()),
    noRetryOn404
  );
  const releases = (feed.items ?? []).filter(
    (item) => item.link && item.title && VERSION.test(item.title)
  );
  // No prior packages signal: take only the newest, not the project's whole history.
  const fresh = since
    ? releases.filter((item) => new Date(item.isoDate ?? item.pubDate ?? "") > since)
    : releases.slice(0, 1);

  for (const item of fresh.slice(0, MAX_PYPI_RELEASES_PER_RUN)) {
    if (await signalExistsBySourceUrl(competitor.id, SOURCE, item.link!)) continue;
    const body = item.contentSnippet ? `\n\n${item.contentSnippet}` : "";
    await emit(
      competitor.id,
      item.link!,
      `${name} ${item.title}`,
      `${name} ${item.title} was published to PyPI.${body}`
    );
  }
}

async function collectPackages(competitor: Competitor, config: PackageConfig): Promise<void> {
  const since = await getLatestSignalCollectedAt(competitor.id, SOURCE);
  const jobs = [
    ...config.npm.map((name) => ({ name, run: () => collectNpm(competitor, name) })),
    ...config.pypi.map((name) => ({ name, run: () => collectPypi(competitor, name, since) })),
  ];

  let failed = 0;
  for (const { name, run } of jobs) {
    try {
      await run();
    } catch (err) {
      if (err instanceof PackageNotFoundError) {
        // A typo'd name is a config problem, not a registry outage — it must
        // not open the circuit for every other competitor.
        logger.warn("package not found on registry — check the competitor's package names", {
          competitor_id: competitor.id,
          package: name,
          reason: err.message,
        });
        continue;
      }
      failed++;
      logger.error("packages collector failed for one package — continuing with the rest", {
        competitor_id: competitor.id,
        package: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (failed > 0) throw new Error(`${failed} of ${jobs.length} packages failed`);
}

export async function packagesCollectorProcessor(_job: Job): Promise<void> {
  return runSourceSweep<PackageConfig>(
    SOURCE,
    (c) =>
      c.npm_packages.length || c.pypi_packages.length
        ? { npm: c.npm_packages, pypi: c.pypi_packages }
        : null,
    collectPackages
  );
}

export function initPackagesWorker() {
  return registerWorker("collect-packages", packagesCollectorProcessor);
}
