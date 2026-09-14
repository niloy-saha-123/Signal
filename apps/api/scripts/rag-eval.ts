// RAG faithfulness evaluation — CI quality gate. For each curated rag_eval_dataset case, runs
// the real competitor-scoped ChatAgent pipeline, validates citation integrity against stored
// signals, scores grounded answers with a runtime-validated faithfulness judge
// (min(correctness, groundedness), computed here — never trusted from the model), persists one
// atomic run, and writes a deterministic secret-free artifact. Exit 0 only when a real evaluation
// ran and aggregate faithfulness met the immutable 0.75 floor; exit 1 on any quality/operational
// failure; exit 78 only for the narrow CI-only prerequisite skip (never a quality pass).
//
// Used in GitHub Actions CI (.github/workflows/ci.yml, job: rag-eval).
//
// Usage:
//   npm run rag-eval --workspace=apps/api
//   npm run rag-eval --workspace=apps/api -- --threshold=0.80
//   npm run rag-eval --workspace=apps/api -- --competitor-id={uuid}
//   npm run rag-eval --workspace=apps/api -- --ci=true --threshold=0.75
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";
import {
  ChatAgentResultSchema,
  type Citation,
  type RagEvalFailureCode,
  type RagEvalResult,
  type RagEvalRunSummary,
} from "@signal/shared";
import { CliUsageError, parseCliArgs, runCli } from "./lib/cli";
import { parseNumericSetting } from "../src/lib/numeric-config";
import {
  RagFaithfulnessJudgeResultSchema,
  type RagFaithfulnessJudgeInput,
} from "../src/evaluation/rag-faithfulness-judge";
import type { ChatAgentInput } from "../src/agents/chat/chat-agent";
import type {
  RagEvalCase,
  RagEvalCitationSignal,
  PersistRagEvaluationInput,
} from "../src/db/queries";
import { logger } from "../src/lib/logger";

const execFileAsync = promisify(execFile);

const MIN_THRESHOLD = 0.75;
const MAX_THRESHOLD = 1;
const PER_CASE_TIMEOUT_MS = 120_000;
const JUDGE_TIMEOUT_MS = 30_000;
const CLEANUP_TIMEOUT_MS = 10_000;

// The immutable floor. No CLI option, environment value, or CI expression may go below it.
const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "REDIS_URL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "COHERE_API_KEY",
  "PINECONE_API_KEY",
] as const;

export class RagEvalOperationalError extends Error {}

// ── CLI options ────────────────────────────────────────────────────────────

const CanonicalUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), "UUID must use canonical lowercase text");

const RagEvalCliOptionsSchema = z
  .object({
    threshold: z.string().min(1).optional(),
    "competitor-id": CanonicalUuidSchema.optional(),
    output: z.string().min(1).optional(),
    ci: z.literal("true").optional(),
  })
  .strict();

export type RagEvaluationOptions = {
  threshold: number;
  competitor_id?: string;
  output?: string;
  ci_triggered: boolean;
};

function resolveThreshold(raw: string | undefined): number {
  if (raw === undefined) {
    return parseNumericSetting("RAG_EVAL_FAITHFULNESS_THRESHOLD", process.env.RAG_EVAL_FAITHFULNESS_THRESHOLD, {
      defaultValue: MIN_THRESHOLD,
      min: MIN_THRESHOLD,
      max: MAX_THRESHOLD,
    });
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_THRESHOLD || value > MAX_THRESHOLD) {
    throw new CliUsageError(`--threshold must be a finite number in [${MIN_THRESHOLD}, ${MAX_THRESHOLD}]`);
  }
  return value;
}

export function parseRagEvalOptions(argv: string[]): RagEvaluationOptions {
  const raw = parseCliArgs(argv, RagEvalCliOptionsSchema);
  return {
    threshold: resolveThreshold(raw.threshold),
    competitor_id: raw["competitor-id"],
    output: raw.output,
    ci_triggered: raw.ci === "true",
  };
}

function missingRequiredEnvVars(env: NodeJS.ProcessEnv): string[] {
  return REQUIRED_ENV_VARS.filter((name) => {
    const value = env[name];
    return value === undefined || value.trim() === "";
  });
}

// ── Dependency and outcome contracts ────────────────────────────────────────

export type RagEvaluationDeps = {
  listCases: (competitorId?: string) => Promise<RagEvalCase[]>;
  getSignals: (ids: readonly string[]) => Promise<RagEvalCitationSignal[]>;
  createAgentRun: (input: { competitor_id: string; trigger: "manual" }) => Promise<{ id: string }>;
  completeAgentRun: (runId: string, status: "completed" | "failed") => Promise<void>;
  failRunIfRunning: (runId: string) => Promise<void>;
  runChatAgent: (input: ChatAgentInput, options: { signal: AbortSignal }) => Promise<unknown>;
  judge: (input: RagFaithfulnessJudgeInput, options: { signal: AbortSignal }) => Promise<unknown>;
  persist: (input: PersistRagEvaluationInput) => Promise<{ id: string; summary: RagEvalRunSummary }>;
  writeArtifact: (path: string, content: string) => Promise<void>;
  now: () => Date;
  gitCommit: () => Promise<string | null>;
};

export type RagEvalArtifact = {
  schema_version: 1;
  run_at: string;
  git_commit: string | null;
  competitor_filter: string | null;
  total_questions: number;
  passed: number;
  failed: number;
  faithfulness_score: number;
  threshold: number;
  gate: "passed" | "failed";
  results: Array<{
    question_id: string;
    category: RagEvalCase["category"];
    response_type: "answer" | "refusal";
    faithfulness_score: number;
    passed: boolean;
    failure_code: RagEvalFailureCode;
    chunks_used: string[];
  }>;
};

export type RagEvaluationSkip = {
  status: "skipped";
  reason: "missing_prerequisites" | "empty_dataset";
  missing?: string[];
};
export type RagEvaluationCompletion = {
  status: "passed" | "failed";
  gate: "passed" | "failed";
  summary: RagEvalRunSummary;
  output_path: string;
};
export type RagEvaluationOutcome = RagEvaluationSkip | RagEvaluationCompletion;

// ── ChatAgent phase — sequential, one real agent_runs row per case ─────────

type CaseChatOutcome =
  | { testCase: RagEvalCase; runId: string; kind: "refusal" }
  | { testCase: RagEvalCase; runId: string; kind: "answer"; answer: string; citations: Citation[] };

// A raw DB error can carry constraint/detail text derived from curated question, answer,
// or signal content; runCli's safeErrorMessage only redacts connection-string patterns.
// Every DB call in this file is wrapped through here so a failure always surfaces as the
// same generic, content-free operational error.
async function safeDbCall<T>(work: () => Promise<T>, message: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RagEvalOperationalError) throw error;
    throw new RagEvalOperationalError(message);
  }
}

async function preflightCuratedProvenance(
  cases: readonly RagEvalCase[],
  deps: RagEvaluationDeps
): Promise<void> {
  const allSupportIds = [...new Set(cases.flatMap((testCase) => testCase.supporting_signal_ids))];
  const hydrated = new Map(
    (await safeDbCall(() => deps.getSignals(allSupportIds), "RAG evaluation aborted: failed to hydrate curated support signals")).map(
      (row) => [row.id, row]
    )
  );
  for (const testCase of cases) {
    for (const supportId of testCase.supporting_signal_ids) {
      const row = hydrated.get(supportId);
      if (!row || row.competitor_id !== testCase.competitor_id) {
        throw new RagEvalOperationalError(
          "RAG evaluation aborted: curated support provenance is invalid or cross-scoped"
        );
      }
    }
  }
}

// Never let a failed best-effort fail-run write vanish silently — the run ID is the
// only way an operator can later find and reap a stranded 'running' agent_runs row.
async function failRunBestEffort(deps: RagEvaluationDeps, runId: string): Promise<void> {
  try {
    await deps.failRunIfRunning(runId);
  } catch {
    logger.error("rag-eval: failed to mark agent run failed — it may be stranded at status=running", {
      run_id: runId,
    });
  }
}

async function runChatAgentPhase(
  cases: readonly RagEvalCase[],
  deps: RagEvaluationDeps,
  signal: AbortSignal
): Promise<CaseChatOutcome[]> {
  const outcomes: CaseChatOutcome[] = [];
  for (const testCase of cases) {
    signal.throwIfAborted();
    const run = await deps.createAgentRun({ competitor_id: testCase.competitor_id, trigger: "manual" });
    const caseSignal = AbortSignal.any([signal, AbortSignal.timeout(PER_CASE_TIMEOUT_MS)]);

    let raw: unknown;
    try {
      raw = await deps.runChatAgent(
        { query: testCase.question, competitor_ids: [testCase.competitor_id], run_id: run.id },
        { signal: caseSignal }
      );
    } catch {
      await failRunBestEffort(deps, run.id);
      throw new RagEvalOperationalError("RAG evaluation aborted: ChatAgent call failed");
    }

    const parsed = ChatAgentResultSchema.safeParse(raw);
    if (!parsed.success) {
      await failRunBestEffort(deps, run.id);
      throw new RagEvalOperationalError("RAG evaluation aborted: ChatAgent returned a malformed result");
    }

    // completeAgentRun is a second write after a successful ChatAgent call — a
    // transient failure here must still mark the run failed (best-effort) rather
    // than leaving it stranded at status='running' with nothing to reap it.
    try {
      await deps.completeAgentRun(run.id, "completed");
    } catch {
      await failRunBestEffort(deps, run.id);
      throw new RagEvalOperationalError("RAG evaluation aborted: failed to finalize the agent run");
    }
    outcomes.push(
      parsed.data.refused
        ? { testCase, runId: run.id, kind: "refusal" }
        : {
            testCase,
            runId: run.id,
            kind: "answer",
            answer: parsed.data.answer,
            citations: parsed.data.citations,
          }
    );
  }
  return outcomes;
}

// ── Citation integrity + judged scoring phase ───────────────────────────────

// Citation.chunk_id is only a string at the shared ChatAgent boundary (not uuid-typed),
// but getRagEvalCitationSignals binds it straight into a `uuid`-column IN(...) query.
// Filtering here keeps a malformed id out of that query entirely — it simply won't be
// in the hydrated map, so firstCitationIntegrityFailure reports the normal, safe
// citation_not_found code instead of an uncaught Postgres cast error crashing the run.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function distinctCitedIds(outcomes: readonly CaseChatOutcome[]): string[] {
  const ids = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.kind === "answer") {
      for (const citation of outcome.citations) {
        if (UUID_PATTERN.test(citation.chunk_id)) ids.add(citation.chunk_id);
      }
    }
  }
  return [...ids];
}

// Keeps first-occurrence order — the persisted result retains "validated citation
// order" per the artifact contract; only the artifact's own chunks_used is sorted.
function dedupeCitations(citations: readonly Citation[]): Citation[] {
  const seen = new Set<string>();
  const result: Citation[] = [];
  for (const citation of citations) {
    if (seen.has(citation.chunk_id)) continue;
    seen.add(citation.chunk_id);
    result.push(citation);
  }
  return result;
}

function firstCitationIntegrityFailure(
  citations: readonly Citation[],
  hydrated: ReadonlyMap<string, RagEvalCitationSignal>,
  competitorId: string
): { code: "citation_not_found" | "citation_scope_violation" | "citation_source_mismatch"; reasoning: string } | null {
  for (const citation of citations) {
    const row = hydrated.get(citation.chunk_id);
    if (!row) {
      return { code: "citation_not_found", reasoning: `Cited signal ${citation.chunk_id} does not exist.` };
    }
    if (row.competitor_id !== competitorId) {
      return {
        code: "citation_scope_violation",
        reasoning: `Cited signal ${citation.chunk_id} belongs to a different competitor.`,
      };
    }
    if (row.source !== citation.source) {
      return {
        code: "citation_source_mismatch",
        reasoning: `Cited signal ${citation.chunk_id} source does not match the citation's declared source.`,
      };
    }
  }
  return null;
}

async function scoreOutcome(
  outcome: CaseChatOutcome,
  hydratedSignals: ReadonlyMap<string, RagEvalCitationSignal>,
  deps: RagEvaluationDeps,
  signal: AbortSignal,
  threshold: number
): Promise<RagEvalResult> {
  const common = {
    question_id: outcome.testCase.id,
    question: outcome.testCase.question,
    category: outcome.testCase.category,
  };

  if (outcome.kind === "refusal") {
    // Every seeded case is answerable by construction — a refusal is a deterministic
    // zero, and it is never sent to the judge.
    return {
      ...common,
      response_type: "refusal",
      refusal_reason: "ChatAgent returned a refusal for a curated answerable case.",
      faithfulness_score: 0,
      passed: false,
      chunks_used: [],
      failure_code: "unexpected_refusal",
      reasoning: "A seeded RAG evaluation case is answerable by construction; a refusal scores zero.",
    };
  }

  const uniqueCitations = dedupeCitations(outcome.citations);
  const integrityFailure = firstCitationIntegrityFailure(
    uniqueCitations,
    hydratedSignals,
    outcome.testCase.competitor_id
  );
  if (integrityFailure) {
    // Still the "answer" variant — ChatAgent produced an answer; the failure is
    // code-enforced, never sent to the judge.
    return {
      ...common,
      response_type: "answer",
      answer: outcome.answer,
      faithfulness_score: 0,
      passed: false,
      chunks_used: [],
      failure_code: integrityFailure.code,
      reasoning: integrityFailure.reasoning,
    };
  }

  const citedSignals = uniqueCitations.map((citation) => {
    const row = hydratedSignals.get(citation.chunk_id);
    if (!row) throw new RagEvalOperationalError("Unreachable: citation integrity already validated");
    return { id: row.id, source: row.source, raw_text: row.raw_text };
  });

  signal.throwIfAborted();
  const judgeSignal = AbortSignal.any([signal, AbortSignal.timeout(JUDGE_TIMEOUT_MS)]);
  let judgeRaw: unknown;
  try {
    judgeRaw = await deps.judge(
      {
        question: outcome.testCase.question,
        expected_answer: outcome.testCase.expected_answer,
        generated_answer: outcome.answer,
        citations: uniqueCitations.map((citation) => ({
          claim: citation.claim,
          chunk_id: citation.chunk_id,
          source: citation.source,
        })),
        cited_signals: citedSignals,
        run_id: outcome.runId,
        competitor_id: outcome.testCase.competitor_id,
      },
      { signal: judgeSignal }
    );
  } catch {
    throw new RagEvalOperationalError("RAG evaluation aborted: faithfulness judge failed");
  }

  const judgeParsed = RagFaithfulnessJudgeResultSchema.safeParse(judgeRaw);
  if (!judgeParsed.success) {
    throw new RagEvalOperationalError("RAG evaluation aborted: faithfulness judge returned a malformed result");
  }

  // Trusted final score — never taken from the model directly.
  const score = Math.min(judgeParsed.data.correctness_score, judgeParsed.data.groundedness_score);
  return {
    ...common,
    response_type: "answer",
    answer: outcome.answer,
    faithfulness_score: score,
    passed: score >= threshold,
    chunks_used: uniqueCitations.map((citation) => citation.chunk_id),
    failure_code: "none",
    reasoning: judgeParsed.data.reasoning,
  };
}

// ── Core orchestration ───────────────────────────────────────────────────

export async function runRagEvalCore(
  options: RagEvaluationOptions,
  deps: RagEvaluationDeps,
  signal: AbortSignal
): Promise<RagEvaluationCompletion> {
  signal.throwIfAborted();
  const runAt = deps.now();
  const cases = await safeDbCall(
    () => deps.listCases(options.competitor_id),
    "RAG evaluation aborted: failed to load the curated dataset"
  );
  if (cases.length === 0) {
    throw new RagEvalOperationalError("No RAG evaluation cases matched the requested scope");
  }

  await preflightCuratedProvenance(cases, deps);
  const outcomes = await runChatAgentPhase(cases, deps, signal);

  const citedIds = distinctCitedIds(outcomes);
  const hydratedSignals =
    citedIds.length === 0
      ? new Map<string, RagEvalCitationSignal>()
      : new Map(
          (await safeDbCall(
            () => deps.getSignals(citedIds),
            "RAG evaluation aborted: failed to hydrate cited signals"
          )).map((row) => [row.id, row])
        );

  const results: RagEvalResult[] = [];
  for (const outcome of outcomes) {
    results.push(await scoreOutcome(outcome, hydratedSignals, deps, signal, options.threshold));
  }

  const gitCommit = await deps.gitCommit();
  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const failed = total - passed;
  const faithfulnessScore = results.reduce((sum, result) => sum + result.faithfulness_score, 0) / total;
  const gate: "passed" | "failed" = faithfulnessScore >= options.threshold ? "passed" : "failed";

  const artifact: RagEvalArtifact = {
    schema_version: 1,
    run_at: runAt.toISOString(),
    git_commit: gitCommit,
    competitor_filter: options.competitor_id ?? null,
    total_questions: total,
    passed,
    failed,
    faithfulness_score: faithfulnessScore,
    threshold: options.threshold,
    gate,
    results: results.map((result) => ({
      question_id: result.question_id,
      category: result.category,
      response_type: result.response_type,
      faithfulness_score: result.faithfulness_score,
      passed: result.passed,
      failure_code: result.failure_code,
      chunks_used: [...new Set(result.chunks_used)].sort(),
    })),
  };

  // Database commit before any filesystem write — a database failure must never
  // leave a file claiming a stored run. Caught and re-thrown generically, same as the
  // ChatAgent/judge call sites: a raw constraint/detail error here can carry curated
  // question/answer/reasoning content and must never reach the safe error boundary.
  let persisted: { id: string; summary: RagEvalRunSummary };
  try {
    persisted = await deps.persist({
      run_at: runAt,
      threshold: options.threshold,
      ci_triggered: options.ci_triggered,
      git_commit: gitCommit,
      results,
    });
  } catch {
    throw new RagEvalOperationalError("RAG evaluation aborted: failed to persist the evaluation run");
  }
  const { summary } = persisted;

  const portableTimestamp = runAt.toISOString().replace(/[:.]/g, "-");
  const outputPath = options.output ?? `rag-eval-results-${portableTimestamp}.json`;
  try {
    await deps.writeArtifact(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  } catch {
    throw new RagEvalOperationalError(
      `RAG evaluation persisted but the result artifact could not be written to ${outputPath}`
    );
  }

  return { status: gate, gate, summary, output_path: outputPath };
}

// ── Default runtime, prerequisite skip, and CLI wiring ─────────────────────

async function defaultGitCommit(): Promise<string | null> {
  try {
    return (await execFileAsync("git", ["rev-parse", "HEAD"])).stdout.trim();
  } catch {
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        // unref: same convention as lib/redis-client.ts's closeRedisConnections — a
        // pending fallback timer must never hold the one-shot CLI process open.
        handle = setTimeout(() => reject(new Error(message)), ms);
        handle.unref();
      }),
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

type RagEvalRuntime = { deps: RagEvaluationDeps; cleanup: () => Promise<void> };

async function loadDefaultRuntime(): Promise<RagEvalRuntime> {
  const [
    {
      listRagEvalCases,
      getRagEvalCitationSignals,
      createAgentRun,
      completeAgentRun,
      failRunIfRunning,
      persistRagEvaluation,
    },
    { closeDatabase },
    { closeRedisConnections },
    { runChatAgent },
    { judgeRagFaithfulness },
  ] = await Promise.all([
    import("../src/db/queries.js"),
    import("../src/db/client.js"),
    import("../src/lib/redis-client.js"),
    import("../src/agents/chat/chat-agent.js"),
    import("../src/evaluation/rag-faithfulness-judge.js"),
  ]);

  const deps: RagEvaluationDeps = {
    listCases: listRagEvalCases,
    getSignals: getRagEvalCitationSignals,
    createAgentRun,
    completeAgentRun,
    failRunIfRunning,
    runChatAgent,
    judge: judgeRagFaithfulness,
    persist: persistRagEvaluation,
    writeArtifact: (path, content) => writeFile(path, content, { encoding: "utf8", flag: "wx" }),
    now: () => new Date(),
    gitCommit: defaultGitCommit,
  };

  return {
    deps,
    cleanup: () =>
      withTimeout(
        Promise.all([closeDatabase(), closeRedisConnections()]).then(() => undefined),
        CLEANUP_TIMEOUT_MS,
        "RAG evaluation cleanup timed out"
      ),
  };
}

// Injected unit-test dependencies bypass the environment preflight and the lazy
// default runtime entirely — this is the pure orchestration entry point.
export async function runRagEval(
  argv: string[],
  dependencies?: RagEvaluationDeps,
  externalSignal?: AbortSignal
): Promise<RagEvaluationOutcome> {
  const options = parseRagEvalOptions(argv);
  const signal = externalSignal ?? new AbortController().signal;

  if (dependencies) {
    return runRagEvalCore(options, dependencies, signal);
  }

  // Only exit-78-eligible: both --ci=true and CI=true. A filtered manual query with
  // no matching cases, a DB outage, or a provider 401 are never a skip.
  const skipEligible = options.ci_triggered && process.env.CI === "true";
  if (skipEligible) {
    const missing = missingRequiredEnvVars(process.env);
    if (missing.length > 0) {
      return { status: "skipped", reason: "missing_prerequisites", missing };
    }
  }

  const runtime = await loadDefaultRuntime();
  try {
    if (skipEligible) {
      const unfiltered = await runtime.deps.listCases();
      if (unfiltered.length === 0) return { status: "skipped", reason: "empty_dataset" };
    }
    return await runRagEvalCore(options, runtime.deps, signal);
  } finally {
    await runtime.cleanup();
  }
}

export type RagEvalCliIo = { stdout: (message: string) => void; stderr: (message: string) => void };
const defaultIo: RagEvalCliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

export async function runRagEvalCli(argv: string[], io: RagEvalCliIo = defaultIo): Promise<number> {
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    return await runCli(
      async () => {
        const outcome = await runRagEval(argv, undefined, controller.signal);
        if (outcome.status === "skipped") {
          io.stdout(JSON.stringify(outcome));
          return 78;
        }
        io.stdout(
          JSON.stringify({
            status: outcome.status,
            gate: outcome.gate,
            summary: outcome.summary,
            output_path: outcome.output_path,
          })
        );
        return outcome.gate === "passed" ? 0 : 1;
      },
      async () => undefined,
      { stderr: io.stderr }
    );
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

if (require.main === module) {
  void runRagEvalCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
