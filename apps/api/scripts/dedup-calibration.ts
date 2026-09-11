// Scores human-labeled signal pairs across explicit semantic-dedup thresholds.
import { createHash } from "node:crypto";
import { z } from "zod";
import { CliUsageError, parseCliArgs, runCli } from "./lib/cli";
import { readUtf8Fixture } from "./lib/fixture-file";
import {
  computeBinaryMetrics,
  selectBestThreshold,
  type ThresholdMetrics,
} from "./lib/metrics";

const PRODUCTION_THRESHOLD = 0.88;

const LabeledPairSchema = z
  .object({
    id: z.string().uuid(),
    left_signal_id: z.string().uuid(),
    right_signal_id: z.string().uuid(),
    similarity: z.number().min(0).max(1),
    same_event: z.boolean(),
  })
  .strict()
  .refine((pair) => pair.left_signal_id !== pair.right_signal_id, {
    message: "A calibration pair must contain two different signals",
    path: ["right_signal_id"],
  });

const CalibrationDatasetSchema = z
  .object({
    schema_version: z.literal(1),
    pairs: z.array(LabeledPairSchema).min(1).max(100_000),
  })
  .strict()
  .superRefine((dataset, context) => {
    const seenIds = new Set<string>();
    const seenPairs = new Set<string>();
    for (const [index, pair] of dataset.pairs.entries()) {
      if (seenIds.has(pair.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate pair id: ${pair.id}`,
          path: ["pairs", index, "id"],
        });
      }
      seenIds.add(pair.id);

      const pairKey = [pair.left_signal_id, pair.right_signal_id].sort().join("|");
      if (seenPairs.has(pairKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate signal pair: ${pairKey}`,
          path: ["pairs", index],
        });
      }
      seenPairs.add(pairKey);
    }
  });

export type CalibrationDataset = z.infer<typeof CalibrationDatasetSchema>;

export type DedupCalibrationReport = {
  schema_version: 1;
  fixture_sha256: string;
  pair_count: number;
  thresholds: ThresholdMetrics[];
  selected_threshold: number;
  production_threshold: number;
  production_threshold_changed: false;
};

const CalibrationOptionsSchema = z
  .object({
    file: z.string().trim().min(1),
    thresholds: z.string().default("0.85,0.88,0.91"),
  })
  .strict();

export type DedupCalibrationDeps = {
  readFile: (path: string) => Promise<string>;
  digest: (content: string) => string;
};

const defaultDeps: DedupCalibrationDeps = {
  readFile: readUtf8Fixture,
  digest: (content) => createHash("sha256").update(content).digest("hex"),
};

export function parseCalibrationDataset(content: string): CalibrationDataset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new CliUsageError("Calibration fixture must be valid JSON");
  }
  const result = CalibrationDatasetSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliUsageError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}

function parseThresholds(value: string): number[] {
  if (value.trim().length === 0) throw new CliUsageError("Threshold list cannot be empty");
  const thresholds = value.split(",").map((entry) => Number(entry.trim()));
  if (
    thresholds.some(
      (threshold) => !Number.isFinite(threshold) || threshold <= 0 || threshold >= 1
    )
  ) {
    throw new CliUsageError("Every threshold must be a number strictly between 0 and 1");
  }
  if (new Set(thresholds).size !== thresholds.length) {
    throw new CliUsageError("Duplicate threshold values are not allowed");
  }
  return thresholds.sort((left, right) => left - right);
}

export function calibrateDeduplication(
  dataset: CalibrationDataset,
  thresholds: number[],
  fixtureSha256 = ""
): DedupCalibrationReport {
  const results = thresholds.map((threshold) => ({
    threshold,
    ...computeBinaryMetrics(
      dataset.pairs.map((pair) => ({
        expected: pair.same_event,
        predicted: pair.similarity >= threshold,
      }))
    ),
  }));
  const selected = selectBestThreshold(results);

  return {
    schema_version: 1,
    fixture_sha256: fixtureSha256,
    pair_count: dataset.pairs.length,
    thresholds: results,
    selected_threshold: selected.threshold,
    production_threshold: PRODUCTION_THRESHOLD,
    // This command is advisory. Changing the runtime constant requires a
    // separately reviewed code change backed by this report and fixture.
    production_threshold_changed: false,
  };
}

export async function runDedupCalibration(
  argv: string[],
  deps: DedupCalibrationDeps = defaultDeps
): Promise<DedupCalibrationReport> {
  const options = parseCliArgs(argv, CalibrationOptionsSchema);
  const thresholds = parseThresholds(options.thresholds);
  const content = await deps.readFile(options.file);
  const dataset = parseCalibrationDataset(content);
  return calibrateDeduplication(dataset, thresholds, deps.digest(content));
}

if (require.main === module) {
  void runCli(
    async () => {
      console.log(JSON.stringify(await runDedupCalibration(process.argv.slice(2)), null, 2));
    },
    async () => undefined
  ).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
