// Scores captured predictions against human-verified historical event cases.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";
import { CliUsageError, parseCliArgs, runCli } from "./lib/cli";
import { readUtf8Fixture } from "./lib/fixture-file";
import { computeBinaryMetrics, type BinaryMetrics } from "./lib/metrics";

const execFileAsync = promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;

const EvidenceSchema = z
  .object({
    source_url: z.string().url(),
    observed_at: z.string().datetime(),
    text: z.string().trim().min(1).max(20_000),
  })
  .strict();

const BacktestPredictionSchema = z
  .object({
    predicted_event: z.boolean(),
    confidence: z.number().min(0).max(1),
    evidence_urls: z.array(z.string().url()).max(100),
    provenance: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((prediction, context) => {
    if (prediction.predicted_event && prediction.evidence_urls.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Positive predictions require at least one evidence URL",
        path: ["evidence_urls"],
      });
    }
  });

const BacktestCaseSchema = z
  .object({
    id: z.string().uuid(),
    competitor_id: z.string().uuid(),
    title: z.string().trim().min(1).max(500),
    observation_cutoff: z.string().datetime(),
    outcome_at: z.string().datetime().nullable(),
    expected_event: z.boolean(),
    evidence: z.array(EvidenceSchema).min(1).max(100),
    prediction: BacktestPredictionSchema,
  })
  .strict()
  .superRefine((testCase, context) => {
    if (testCase.expected_event && testCase.outcome_at === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Positive cases require outcome_at",
        path: ["outcome_at"],
      });
    }
    if (!testCase.expected_event && testCase.outcome_at !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Control cases must use outcome_at: null",
        path: ["outcome_at"],
      });
    }
    const cutoff = Date.parse(testCase.observation_cutoff);
    if (
      testCase.expected_event &&
      testCase.outcome_at !== null &&
      cutoff >= Date.parse(testCase.outcome_at)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Positive case observation_cutoff must be before outcome_at",
        path: ["observation_cutoff"],
      });
    }
    const sourceUrls = new Set(testCase.evidence.map((evidence) => evidence.source_url));
    for (const [index, evidence] of testCase.evidence.entries()) {
      if (Date.parse(evidence.observed_at) > cutoff) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Evidence cannot be newer than the observation cutoff",
          path: ["evidence", index, "observed_at"],
        });
      }
    }
    for (const [index, url] of testCase.prediction.evidence_urls.entries()) {
      if (!sourceUrls.has(url)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Prediction contains uncited evidence URL: ${url}`,
          path: ["prediction", "evidence_urls", index],
        });
      }
    }
  });

const BacktestDatasetSchema = z
  .object({
    schema_version: z.literal(1),
    cases: z.array(BacktestCaseSchema).min(1).max(10_000),
  })
  .strict()
  .superRefine((dataset, context) => {
    const seen = new Set<string>();
    for (const [index, testCase] of dataset.cases.entries()) {
      if (seen.has(testCase.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate backtest case id: ${testCase.id}`,
          path: ["cases", index, "id"],
        });
      }
      seen.add(testCase.id);
    }
  });

export type BacktestDataset = z.infer<typeof BacktestDatasetSchema>;
export type BacktestCase = BacktestDataset["cases"][number];
export type BacktestPrediction = z.infer<typeof BacktestPredictionSchema>;

type BacktestCaseResult = {
  id: string;
  competitor_id: string;
  title: string;
  observation_cutoff: string;
  outcome_at: string | null;
  expected_event: boolean;
  predicted_event: boolean;
  confidence: number;
  correct: boolean;
  lead_time_days: number | null;
  evidence_urls: string[];
  provenance: string;
};

export type BacktestReport = {
  schema_version: 1;
  generated_at: string;
  git_commit: string;
  fixture_sha256: string;
  metrics: BinaryMetrics;
  mean_correct_lead_time_days: number | null;
  confidence_buckets: Array<{
    bucket: string;
    total: number;
    correct: number;
    accuracy: number;
  }>;
  cases: BacktestCaseResult[];
};

type BacktestReportDeps = {
  predict: (testCase: BacktestCase) => Promise<BacktestPrediction>;
  now: () => Date;
  gitCommit: () => Promise<string>;
  digest: (content: string) => string;
};

export type BacktestDeps = BacktestReportDeps & {
  readFile: (path: string) => Promise<string>;
  writeArtifact: (path: string, content: string) => Promise<void>;
};

const BacktestOptionsSchema = z
  .object({
    file: z.string().trim().min(1),
    output: z.string().trim().min(1).optional(),
  })
  .strict();

const defaultDeps: BacktestDeps = {
  readFile: readUtf8Fixture,
  writeArtifact: (path, content) => writeFile(path, content, { encoding: "utf8", flag: "wx" }),
  predict: async (testCase) => testCase.prediction,
  now: () => new Date(),
  gitCommit: async () => (await execFileAsync("git", ["rev-parse", "HEAD"])).stdout.trim(),
  digest: (content) => createHash("sha256").update(content).digest("hex"),
};

export function parseBacktestDataset(content: string): BacktestDataset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new CliUsageError("Backtest fixture must be valid JSON");
  }
  const result = BacktestDatasetSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliUsageError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}

function confidenceBucket(confidence: number): string {
  const lower = Math.min(Math.floor(confidence * 10) / 10, 0.9);
  const upper = lower + 0.1;
  return `${lower.toFixed(2)}-${upper.toFixed(2)}`;
}

export async function buildBacktestReport(
  dataset: BacktestDataset,
  deps: BacktestReportDeps
): Promise<BacktestReport> {
  const results: BacktestCaseResult[] = [];
  for (const testCase of dataset.cases) {
    const prediction = BacktestPredictionSchema.parse(await deps.predict(testCase));
    const allowedEvidenceUrls = new Set(
      testCase.evidence.map((evidence) => evidence.source_url)
    );
    const uncitedUrl = prediction.evidence_urls.find((url) => !allowedEvidenceUrls.has(url));
    if (uncitedUrl) {
      throw new CliUsageError(`Prediction contains uncited evidence URL: ${uncitedUrl}`);
    }
    const correct = prediction.predicted_event === testCase.expected_event;
    const leadTimeDays =
      correct && testCase.expected_event && testCase.outcome_at
        ? (Date.parse(testCase.outcome_at) - Date.parse(testCase.observation_cutoff)) / DAY_MS
        : null;
    results.push({
      id: testCase.id,
      competitor_id: testCase.competitor_id,
      title: testCase.title,
      observation_cutoff: testCase.observation_cutoff,
      outcome_at: testCase.outcome_at,
      expected_event: testCase.expected_event,
      predicted_event: prediction.predicted_event,
      confidence: prediction.confidence,
      correct,
      lead_time_days: leadTimeDays,
      evidence_urls: prediction.evidence_urls,
      provenance: prediction.provenance,
    });
  }

  const leadTimes = results.flatMap((result) =>
    result.lead_time_days === null ? [] : [result.lead_time_days]
  );
  const buckets = new Map<string, { total: number; correct: number }>();
  for (const result of results) {
    const bucket = confidenceBucket(result.confidence);
    const current = buckets.get(bucket) ?? { total: 0, correct: 0 };
    current.total += 1;
    if (result.correct) current.correct += 1;
    buckets.set(bucket, current);
  }

  return {
    schema_version: 1,
    generated_at: deps.now().toISOString(),
    git_commit: await deps.gitCommit(),
    fixture_sha256: deps.digest(JSON.stringify(dataset)),
    metrics: computeBinaryMetrics(
      results.map((result) => ({
        expected: result.expected_event,
        predicted: result.predicted_event,
      }))
    ),
    mean_correct_lead_time_days:
      leadTimes.length === 0
        ? null
        : leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length,
    confidence_buckets: [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([bucket, counts]) => ({
        bucket,
        ...counts,
        accuracy: counts.correct / counts.total,
      })),
    cases: results,
  };
}

export async function runBacktest(
  argv: string[],
  deps: BacktestDeps = defaultDeps
): Promise<{ output_path: string; report: BacktestReport }> {
  const options = parseCliArgs(argv, BacktestOptionsSchema);
  const content = await deps.readFile(options.file);
  const dataset = parseBacktestDataset(content);
  const report = await buildBacktestReport(dataset, {
    ...deps,
    digest: () => deps.digest(content),
  });
  const portableTimestamp = report.generated_at.replace(/[:.]/g, "-");
  const outputPath = options.output ?? `backtest-results-${portableTimestamp}.json`;
  await deps.writeArtifact(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return { output_path: outputPath, report };
}

if (require.main === module) {
  void runCli(
    async () => {
      console.log(JSON.stringify(await runBacktest(process.argv.slice(2)), null, 2));
    },
    async () => undefined
  ).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
