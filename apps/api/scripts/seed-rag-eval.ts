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

export function parseRagEvalSeedDataset(content: string): RagEvalSeedDataset {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new CliUsageError("RAG eval fixture must be valid JSON"); }
  const result = RagEvalSeedDatasetSchema.safeParse(parsed);
  if (!result.success) throw new CliUsageError(result.error.issues.map((issue) => issue.message).join("; "));
  return result.data;
}

async function loadDefaultSeedRepository(): Promise<SeedRagEvalDeps["seedRagEvalDataset"]> {
  return (await import("../src/db/queries.js")).seedRagEvalDataset;
}

async function readRagEvalFixture(
  readFile: SeedRagEvalDeps["readFile"],
  path: string
): Promise<string> {
  try {
    return await readFile(path);
  } catch (error) {
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

export async function runSeedRagEval(argv: string[], dependencies?: SeedRagEvalDeps): Promise<SeedRagEvalSummary> {
  const options = parseCliArgs(argv, SeedRagEvalOptionsSchema);
  const content = await readRagEvalFixture(dependencies?.readFile ?? readUtf8Fixture, options.file);
  const dataset = parseRagEvalSeedDataset(content);
  const seed = dependencies?.seedRagEvalDataset ?? (await loadDefaultSeedRepository());
  return summaryFor(dataset, await seed(dataset.cases));
}

if (require.main === module) {
  let cleanup: () => Promise<void> = async () => undefined;
  void runCli(async () => {
    const options = parseCliArgs(process.argv.slice(2), SeedRagEvalOptionsSchema);
    const dataset = parseRagEvalSeedDataset(await readRagEvalFixture(readUtf8Fixture, options.file));
    const [{ seedRagEvalDataset }, { closeDatabase }] = await Promise.all([
      import("../src/db/queries.js"), import("../src/db/client.js"),
    ]);
    cleanup = closeDatabase;
    console.log(JSON.stringify(summaryFor(dataset, await seedRagEvalDataset(dataset.cases))));
  }, () => cleanup()).then((exitCode) => { process.exitCode = exitCode; });
}
