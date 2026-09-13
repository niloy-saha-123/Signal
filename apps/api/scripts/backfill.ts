// Enqueues bounded historical Reddit/Hacker News collection for one competitor.
import { z } from "zod";
import type { CollectorJobData } from "../src/collectors/job-data";
import { CliUsageError, parseCliArgs, runCli } from "./lib/cli";

const BackfillSourceSchema = z.enum(["reddit", "hn"]);
export type BackfillSource = z.infer<typeof BackfillSourceSchema>;

const BackfillOptionsSchema = z
  .object({
    "competitor-id": z.string().uuid(),
    days: z.coerce.number().int().min(1).max(365).default(30),
    sources: z.string().default("reddit,hn"),
    "dry-run": z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .strict();

export type BackfillInput = {
  competitor_id: string;
  days: number;
  sources: BackfillSource[];
  dry_run: boolean;
};

export type BackfillPlan = {
  competitor_id: string;
  since: string;
  until: string;
  jobs: Array<{
    source: BackfillSource;
    queue: "collect-reddit" | "collect-hn";
    job_id: string;
  }>;
  dry_run: boolean;
};

type EnsureBackfillJob = (
  name: string,
  data: CollectorJobData,
  options: { jobId: string }
) => Promise<unknown>;

export type BackfillDeps = {
  getCompetitorById: (
    id: string
  ) => Promise<{ id: string; is_active: boolean } | undefined>;
  ensureRedditJob: EnsureBackfillJob;
  ensureHnJob: EnsureBackfillJob;
  now: () => Date;
};

let closeDefaultRuntime: (() => Promise<void>) | undefined;

function parseSources(value: string): BackfillSource[] {
  const entries = value.split(",").map((source) => source.trim());
  if (entries.some((source) => source.length === 0)) {
    throw new CliUsageError("Backfill sources cannot contain empty values");
  }

  const sources: BackfillSource[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const parsed = BackfillSourceSchema.safeParse(entry);
    if (!parsed.success) throw new CliUsageError(`Unsupported backfill source: ${entry}`);
    if (seen.has(parsed.data)) {
      throw new CliUsageError(`Duplicate backfill source: ${parsed.data}`);
    }
    seen.add(parsed.data);
    sources.push(parsed.data);
  }
  return sources;
}

export function planBackfill(input: BackfillInput, now: Date): BackfillPlan {
  const until = now.toISOString();
  const since = new Date(now.getTime() - input.days * 24 * 60 * 60 * 1000).toISOString();
  const sinceDay = since.slice(0, 10);
  const untilDay = until.slice(0, 10);

  return {
    competitor_id: input.competitor_id,
    since,
    until,
    jobs: input.sources.map((source) => ({
      source,
      queue: source === "reddit" ? "collect-reddit" : "collect-hn",
      // BullMQ forbids ':' inside custom IDs. Day-scoped IDs suppress
      // duplicate in-flight requests while database URL dedup keeps reruns safe.
      job_id: `backfill-${source}-${input.competitor_id}-${sinceDay}-${untilDay}`,
    })),
    dry_run: input.dry_run,
  };
}

async function loadDefaultDeps(): Promise<BackfillDeps> {
  const [
    { getCompetitorById },
    { queues, ensureStableJob },
    { closeDatabase },
    { closeRedisConnections },
  ] =
    await Promise.all([
      import("../src/db/queries.js"),
      import("../src/queues/registry.js"),
      import("../src/db/client.js"),
      import("../src/lib/redis-client.js"),
    ]);
  closeDefaultRuntime = async () => {
    await Promise.allSettled(Object.values(queues).map((queue) => queue.close()));
    await closeRedisConnections();
    await closeDatabase();
  };
  return {
    getCompetitorById,
    ensureRedditJob: (name, data, options) =>
      ensureStableJob(queues["collect-reddit"], {
        name,
        data,
        jobId: options.jobId,
      }),
    ensureHnJob: (name, data, options) =>
      ensureStableJob(queues["collect-hn"], {
        name,
        data,
        jobId: options.jobId,
      }),
    now: () => new Date(),
  };
}

export async function runBackfill(
  argv: string[],
  dependencies?: BackfillDeps
): Promise<BackfillPlan> {
  const options = parseCliArgs(argv, BackfillOptionsSchema);
  const input: BackfillInput = {
    competitor_id: options["competitor-id"],
    days: options.days,
    sources: parseSources(options.sources),
    dry_run: options["dry-run"],
  };
  const deps = dependencies ?? (await loadDefaultDeps());
  const competitor = await deps.getCompetitorById(input.competitor_id);
  if (!competitor) throw new CliUsageError(`Competitor ${input.competitor_id} not found`);
  if (!competitor.is_active) {
    throw new CliUsageError(`Competitor ${input.competitor_id} is inactive`);
  }

  const plan = planBackfill(input, deps.now());
  if (plan.dry_run) return plan;

  await Promise.all(
    plan.jobs.map((job) => {
      const ensureJob =
        job.source === "reddit" ? deps.ensureRedditJob : deps.ensureHnJob;
      return ensureJob(
        "backfill",
        {
          backfill: {
            competitor_id: plan.competitor_id,
            since: plan.since,
            until: plan.until,
          },
        },
        { jobId: job.job_id }
      );
    })
  );
  return plan;
}

if (require.main === module) {
  void runCli(
    async () => {
      console.log(JSON.stringify(await runBackfill(process.argv.slice(2)), null, 2));
    },
    async () => {
      await closeDefaultRuntime?.();
    }
  ).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
