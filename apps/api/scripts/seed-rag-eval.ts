// Imports an explicitly supplied, human-curated RAG evaluation fixture.
import { z } from "zod";
import type { RagEvalSeedCaseInput, RagEvalSeedResult } from "../src/db/queries";
import { CliUsageError, parseCliArgs, runCli } from "./lib/cli";
import { readUtf8Fixture } from "./lib/fixture-file";

const RagEvalCategorySchema = z.enum([
  "pricing_history", "hiring_pattern", "product_change", "sentiment_theme", "strategic_move", "general",
]);
const RagEvalConfidenceSchema = z.enum(["high", "medium", "low"]);
const CanonicalUuidSchema = z.string().uuid().refine(
  (value) => value === value.toLowerCase(), "UUIDs must use canonical lowercase text"
);
const ExactQuestionSchema = z.string().min(1).max(2_000).refine(
  (value) => value === value.trim(), "Question must not have surrounding whitespace"
);
const ExactAnswerSchema = z.string().min(1).max(20_000).refine(
  (value) => value === value.trim(), "Expected answer must not have surrounding whitespace"
);
const RagEvalSeedCaseSchema = z.object({
  id: CanonicalUuidSchema,
  competitor_id: CanonicalUuidSchema,
  category: RagEvalCategorySchema,
  question: ExactQuestionSchema,
  expected_answer: ExactAnswerSchema,
  supporting_signal_ids: z.array(CanonicalUuidSchema).min(1).max(100),
  confidence_level: RagEvalConfidenceSchema,
}).strict().superRefine((seedCase, context) => {
  const seen = new Set<string>();
  for (const [index, signalId] of seedCase.supporting_signal_ids.entries()) {
    if (seen.has(signalId)) context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate supporting signal id: ${signalId}`,
      path: ["supporting_signal_ids", index],
    });
    seen.add(signalId);
  }
});
const RagEvalSeedDatasetSchema = z.object({
  schema_version: z.literal(1),
  cases: z.array(RagEvalSeedCaseSchema).min(1).max(1_000),
}).strict().superRefine((dataset, context) => {
  const seen = new Set<string>();
  for (const [index, seedCase] of dataset.cases.entries()) {
    if (seen.has(seedCase.id)) context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate RAG eval case id: ${seedCase.id}`,
      path: ["cases", index, "id"],
    });
    seen.add(seedCase.id);
  }
});
const SeedRagEvalOptionsSchema = z.object({ file: z.string().min(1) }).strict();

export type RagEvalSeedDataset = z.infer<typeof RagEvalSeedDatasetSchema>;
export type RagEvalSeedCase = RagEvalSeedDataset["cases"][number];
export type SeedRagEvalDeps = {
  readFile: (path: string) => Promise<string>;
  seedRagEvalDataset: (cases: readonly RagEvalSeedCaseInput[]) => Promise<RagEvalSeedResult>;
};
export type SeedRagEvalSummary = { schema_version: 1; total: number; inserted: number; unchanged: number };
export type SeedRagEvalRuntime = {
  seedRagEvalDataset: SeedRagEvalDeps["seedRagEvalDataset"];
  cleanup: () => Promise<void>;
};
export type SeedRagEvalCliIo = { stdout: (message: string) => void; stderr: (message: string) => void };

export function parseRagEvalSeedDataset(content: string): RagEvalSeedDataset {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new CliUsageError("RAG eval fixture must be valid JSON"); }
  if (!RagEvalSeedDatasetSchema.safeParse(parsed).success) {
    throw new CliUsageError("RAG eval fixture failed validation");
  }
  return RagEvalSeedDatasetSchema.parse(parsed);
}

function parseSeedRagEvalOptions(argv: string[]): z.output<typeof SeedRagEvalOptionsSchema> {
  try { return parseCliArgs(argv, SeedRagEvalOptionsSchema); } catch {
    throw new CliUsageError("Invalid RAG eval seed command options");
  }
}

async function loadDefaultRuntime(): Promise<SeedRagEvalRuntime> {
  const [{ seedRagEvalDataset }, { closeDatabase }] = await Promise.all([
    import("../src/db/queries.js"), import("../src/db/client.js"),
  ]);
  return { seedRagEvalDataset, cleanup: closeDatabase };
}

async function loadSeedRuntime(
  loadRuntime: () => Promise<SeedRagEvalRuntime>
): Promise<SeedRagEvalRuntime> {
  try {
    return await loadRuntime();
  } catch {
    throw new Error("RAG eval seed runtime failed");
  }
}

async function cleanupSeedRuntime(cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup();
  } catch {
    throw new Error("RAG eval seed cleanup failed");
  }
}

async function readRagEvalFixture(readFile: SeedRagEvalDeps["readFile"], path: string): Promise<string> {
  try { return await readFile(path); } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError("Unable to read RAG eval fixture");
  }
}

function summaryFor(dataset: RagEvalSeedDataset, result: RagEvalSeedResult): SeedRagEvalSummary {
  if (!Number.isSafeInteger(result.inserted) || !Number.isSafeInteger(result.unchanged) ||
    result.inserted < 0 || result.unchanged < 0 || result.inserted + result.unchanged !== dataset.cases.length) {
    throw new Error("RAG eval seed repository returned inconsistent counts");
  }
  return { schema_version: 1, total: dataset.cases.length, inserted: result.inserted, unchanged: result.unchanged };
}

function isSafeDomainError(error: unknown): error is Error {
  return error instanceof Error &&
    (error.name === "RagEvalSeedConflictError" || error.name === "RagEvalSeedReferenceError");
}

async function seedValidatedDataset(
  dataset: RagEvalSeedDataset,
  seed: SeedRagEvalDeps["seedRagEvalDataset"]
): Promise<SeedRagEvalSummary> {
  try { return summaryFor(dataset, await seed(dataset.cases)); } catch (error) {
    if (isSafeDomainError(error) ||
      error instanceof Error && error.message === "RAG eval seed repository returned inconsistent counts") throw error;
    throw new Error("RAG eval seed failed");
  }
}

async function readValidatedDataset(
  argv: string[], readFile: SeedRagEvalDeps["readFile"]
): Promise<RagEvalSeedDataset> {
  const options = parseSeedRagEvalOptions(argv);
  return parseRagEvalSeedDataset(await readRagEvalFixture(readFile, options.file));
}

export async function runSeedRagEval(argv: string[], dependencies?: SeedRagEvalDeps): Promise<SeedRagEvalSummary> {
  const dataset = await readValidatedDataset(argv, dependencies?.readFile ?? readUtf8Fixture);
  if (dependencies) return seedValidatedDataset(dataset, dependencies.seedRagEvalDataset);
  const runtime = await loadSeedRuntime(loadDefaultRuntime);
  try { return await seedValidatedDataset(dataset, runtime.seedRagEvalDataset); } finally { await cleanupSeedRuntime(runtime.cleanup); }
}

const defaultIo: SeedRagEvalCliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

export async function runSeedRagEvalCli(
  argv: string[],
  readFile: SeedRagEvalDeps["readFile"] = readUtf8Fixture,
  loadRuntime: () => Promise<SeedRagEvalRuntime> = loadDefaultRuntime,
  io: SeedRagEvalCliIo = defaultIo
): Promise<number> {
  let cleanup: () => Promise<void> = async () => undefined;
  return runCli(async () => {
    const dataset = await readValidatedDataset(argv, readFile);
    const runtime = await loadSeedRuntime(loadRuntime);
    cleanup = () => cleanupSeedRuntime(runtime.cleanup);
    io.stdout(JSON.stringify(await seedValidatedDataset(dataset, runtime.seedRagEvalDataset)));
  }, () => cleanup(), { stderr: io.stderr });
}

if (require.main === module) {
  void runSeedRagEvalCli(process.argv.slice(2)).then((exitCode) => { process.exitCode = exitCode; });
}
