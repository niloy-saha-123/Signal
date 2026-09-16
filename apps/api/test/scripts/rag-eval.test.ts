import { describe, expect, it, vi } from "vitest";
import {
  parseRagEvalOptions,
  runRagEval,
  runRagEvalCli,
  type RagEvaluationDeps,
  type RagEvaluationOutcome,
  type RagEvaluationCompletion,
} from "../../scripts/rag-eval";
import type { RagEvalCase, RagEvalCitationSignal, PersistRagEvaluationInput } from "../../src/db/queries";

function expectCompletion(outcome: RagEvaluationOutcome): asserts outcome is RagEvaluationCompletion {
  if (outcome.status === "skipped") {
    throw new Error(`Expected a completed run, got skip: ${JSON.stringify(outcome)}`);
  }
}

function uuid(seed: string): string {
  return `00000000-0000-4000-8000-${seed.padStart(12, "0")}`;
}

const COMPETITOR_A = uuid("1");
const COMPETITOR_B = uuid("2");
const WORKSPACE_ID = uuid("999");
const SIGNAL_1 = uuid("101");
const SIGNAL_2 = uuid("102");
const RUN_ID = uuid("900");

function testCase(overrides: Partial<RagEvalCase> = {}): RagEvalCase {
  return {
    id: uuid("500"),
    competitor_id: COMPETITOR_A,
    category: "pricing_history",
    question: "What is Acme's pricing?",
    expected_answer: "Acme charges $10/month for Pro.",
    supporting_signal_ids: [SIGNAL_1],
    confidence_level: "high",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function citationSignal(overrides: Partial<RagEvalCitationSignal> = {}): RagEvalCitationSignal {
  return {
    id: SIGNAL_1,
    competitor_id: COMPETITOR_A,
    source: "pricing",
    title: "Pricing page",
    raw_text: "Pro plan is $10/month.",
    ...overrides,
  };
}

function answerResult(overrides: Record<string, unknown> = {}) {
  return {
    refused: false,
    answer: "Acme charges $10/month for its Pro plan.",
    citations: [
      { claim: "Acme charges $10/month for Pro.", chunk_id: SIGNAL_1, source: "pricing", similarity_score: 0.9 },
    ],
    ...overrides,
  };
}

function refusalResult() {
  return { refused: true, reason: "No evidence.", suggested_query: "Try again." };
}

function judgeResult(overrides: Record<string, unknown> = {}) {
  return { correctness_score: 0.9, groundedness_score: 0.9, reasoning: "Well grounded.", ...overrides };
}

function baseDeps(overrides: Partial<RagEvaluationDeps> = {}): RagEvaluationDeps {
  return {
    listCases: vi.fn(async () => [testCase()]),
    getSignals: vi.fn(async (ids: readonly string[]) =>
      ids.includes(SIGNAL_1) ? [citationSignal()] : []
    ),
    getCompetitorById: vi.fn(async () => ({ workspace_id: WORKSPACE_ID })),
    createAgentRun: vi.fn(async () => ({ id: RUN_ID })),
    completeAgentRun: vi.fn(async () => undefined),
    failRunIfRunning: vi.fn(async () => undefined),
    runChatAgent: vi.fn(async () => answerResult()),
    judge: vi.fn(async () => judgeResult()),
    persist: vi.fn(async (input: PersistRagEvaluationInput) => ({
      id: "run-1",
      summary: {
        run_at: input.run_at.toISOString(),
        total_questions: input.results.length,
        passed: input.results.filter((r) => r.passed).length,
        failed: input.results.filter((r) => !r.passed).length,
        faithfulness_score:
          input.results.reduce((sum, r) => sum + r.faithfulness_score, 0) / input.results.length,
        threshold: input.threshold,
        ci_triggered: input.ci_triggered,
        git_commit: input.git_commit,
      },
    })),
    writeArtifact: vi.fn(async () => undefined),
    now: () => new Date("2026-03-01T00:00:00.000Z"),
    gitCommit: vi.fn(async () => "abc123"),
    ...overrides,
  };
}

describe("parseRagEvalOptions", () => {
  it("defaults threshold to 0.75 when absent", () => {
    expect(parseRagEvalOptions([]).threshold).toBe(0.75);
  });

  it("accepts a stricter explicit threshold", () => {
    expect(parseRagEvalOptions(["--threshold=0.9"]).threshold).toBe(0.9);
  });

  it("accepts the exact floor", () => {
    expect(parseRagEvalOptions(["--threshold=0.75"]).threshold).toBe(0.75);
  });

  it.each([
    ["below the floor", "--threshold=0.5"],
    ["above 1", "--threshold=1.1"],
    ["NaN", "--threshold=NaN"],
    ["Infinity", "--threshold=Infinity"],
    ["exponent overflow", "--threshold=1e400"],
    ["empty", "--threshold="],
  ])("rejects %s", (_label, arg) => {
    expect(() => parseRagEvalOptions([arg])).toThrow();
  });

  it("rejects a malformed competitor id", () => {
    expect(() => parseRagEvalOptions(["--competitor-id=not-a-uuid"])).toThrow();
  });

  it("rejects a non-canonical (uppercase) competitor id", () => {
    const uppercaseUuid = "ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF";
    expect(() => parseRagEvalOptions([`--competitor-id=${uppercaseUuid}`])).toThrow();
  });

  it("rejects any --ci value other than true", () => {
    expect(() => parseRagEvalOptions(["--ci=false"])).toThrow();
  });

  it.each([
    ["duplicate option", ["--threshold=0.8", "--threshold=0.9"]],
    ["unknown option", ["--unknown=x"]],
    ["positional argument", ["positional"]],
    ["empty output", ["--output="]],
  ])("rejects %s", (_label, argv) => {
    expect(() => parseRagEvalOptions(argv)).toThrow();
  });

  it("accepts --ci=true and a valid competitor filter together", () => {
    const options = parseRagEvalOptions(["--ci=true", `--competitor-id=${COMPETITOR_A}`]);
    expect(options.ci_triggered).toBe(true);
    expect(options.competitor_id).toBe(COMPETITOR_A);
  });
});

describe("runRagEval — dataset scope and provenance preflight", () => {
  it("calls ChatAgent with exactly one competitor scope per case, in dataset order", async () => {
    const first = testCase({ id: uuid("501"), competitor_id: COMPETITOR_A });
    const second = testCase({ id: uuid("502"), competitor_id: COMPETITOR_B, supporting_signal_ids: [SIGNAL_2] });
    const deps = baseDeps({
      listCases: vi.fn(async () => [first, second]),
      getSignals: vi.fn(async (ids: readonly string[]) =>
        [citationSignal({ id: SIGNAL_1 }), citationSignal({ id: SIGNAL_2, competitor_id: COMPETITOR_B })].filter(
          (row) => ids.includes(row.id)
        )
      ),
    });

    await runRagEval([], deps);

    const calls = (deps.runChatAgent as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({ competitor_ids: [COMPETITOR_A] });
    expect(calls[1][0]).toMatchObject({ competitor_ids: [COMPETITOR_B] });
  });

  it("passes the competitor filter through to listCases", async () => {
    const deps = baseDeps();
    await runRagEval([`--competitor-id=${COMPETITOR_A}`], deps);
    expect(deps.listCases).toHaveBeenCalledWith(COMPETITOR_A);
  });

  it("aborts before any ChatAgent call when a case's dataset scope has no matches", async () => {
    const deps = baseDeps({ listCases: vi.fn(async () => []) });
    await expect(runRagEval([], deps)).rejects.toThrow();
    expect(deps.runChatAgent).not.toHaveBeenCalled();
  });

  it("aborts before any ChatAgent call on a missing support reference", async () => {
    const deps = baseDeps({ getSignals: vi.fn(async () => []) });
    await expect(runRagEval([], deps)).rejects.toThrow();
    expect(deps.runChatAgent).not.toHaveBeenCalled();
  });

  it("aborts before any ChatAgent call on a cross-competitor support reference", async () => {
    const deps = baseDeps({
      getSignals: vi.fn(async () => [citationSignal({ competitor_id: COMPETITOR_B })]),
    });
    await expect(runRagEval([], deps)).rejects.toThrow();
    expect(deps.runChatAgent).not.toHaveBeenCalled();
  });
});

describe("runRagEval — ChatAgent result boundary", () => {
  it("scores a typed refusal as a deterministic zero without calling the judge", async () => {
    const deps = baseDeps({ runChatAgent: vi.fn(async () => refusalResult()) });
    const outcome = await runRagEval([], deps);
    expect(outcome).toMatchObject({ status: "failed", gate: "failed" });
    expect(deps.judge).not.toHaveBeenCalled();
    expect(deps.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [expect.objectContaining({ response_type: "refusal", failure_code: "unexpected_refusal", passed: false })],
      })
    );
  });

  it("marks the run completed for a refusal (ChatAgent itself did not fail)", async () => {
    const deps = baseDeps({ runChatAgent: vi.fn(async () => refusalResult()) });
    await runRagEval([], deps);
    expect(deps.completeAgentRun).toHaveBeenCalledWith(RUN_ID, "completed");
    expect(deps.failRunIfRunning).not.toHaveBeenCalled();
  });

  it("fails the run and aborts the whole evaluation on a malformed ChatAgent result", async () => {
    const deps = baseDeps({ runChatAgent: vi.fn(async () => ({ nonsense: true })) });
    await expect(runRagEval([], deps)).rejects.toThrow();
    expect(deps.failRunIfRunning).toHaveBeenCalledWith(RUN_ID);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("fails the run and aborts the whole evaluation when finalizing a successful run itself fails", async () => {
    const deps = baseDeps({ completeAgentRun: vi.fn(async () => { throw new Error("connection reset"); }) });
    await expect(runRagEval([], deps)).rejects.toThrow();
    expect(deps.failRunIfRunning).toHaveBeenCalledWith(RUN_ID);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("fails the run and aborts the whole evaluation on a ChatAgent rejection", async () => {
    const deps = baseDeps({ runChatAgent: vi.fn(async () => { throw new Error("provider down"); }) });
    await expect(runRagEval([], deps)).rejects.toThrow();
    expect(deps.failRunIfRunning).toHaveBeenCalledWith(RUN_ID);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("propagates an already-aborted caller signal as an operational failure", async () => {
    const deps = baseDeps();
    const controller = new AbortController();
    controller.abort();
    await expect(runRagEval([], deps, controller.signal)).rejects.toThrow();
    expect(deps.persist).not.toHaveBeenCalled();
  });
});

describe("runRagEval — citation integrity", () => {
  it("scores citation_not_found as a zero without calling the judge", async () => {
    const deps = baseDeps({ getSignals: vi.fn(async (ids) => (ids.includes(SIGNAL_1) && ids.length === 1 ? [citationSignal()] : [])) });
    // First getSignals call (provenance) returns the support row; second (citation hydration) returns none.
    let call = 0;
    deps.getSignals = vi.fn(async () => {
      call += 1;
      return call === 1 ? [citationSignal()] : [];
    });
    const outcome = await runRagEval([], deps);
    expectCompletion(outcome);
    expect(outcome.gate).toBe("failed");
    expect(deps.judge).not.toHaveBeenCalled();
    expect(deps.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [expect.objectContaining({ failure_code: "citation_not_found", faithfulness_score: 0 })],
      })
    );
  });

  it("scores citation_scope_violation when the cited signal belongs to another competitor", async () => {
    let call = 0;
    const deps = baseDeps({
      getSignals: vi.fn(async () => {
        call += 1;
        return call === 1 ? [citationSignal()] : [citationSignal({ competitor_id: COMPETITOR_B })];
      }),
    });
    await runRagEval([], deps);
    expect(deps.judge).not.toHaveBeenCalled();
    expect(deps.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [expect.objectContaining({ failure_code: "citation_scope_violation" })],
      })
    );
  });

  it("scores citation_source_mismatch when the stored source disagrees with the citation", async () => {
    let call = 0;
    const deps = baseDeps({
      getSignals: vi.fn(async () => {
        call += 1;
        return call === 1 ? [citationSignal()] : [citationSignal({ source: "reddit" })];
      }),
    });
    await runRagEval([], deps);
    expect(deps.judge).not.toHaveBeenCalled();
    expect(deps.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [expect.objectContaining({ failure_code: "citation_source_mismatch" })],
      })
    );
  });

  it("treats a non-UUID chunk_id as citation_not_found instead of querying the database", async () => {
    const deps = baseDeps({
      runChatAgent: vi.fn(async () =>
        answerResult({
          citations: [{ claim: "a", chunk_id: "not-a-uuid", source: "pricing", similarity_score: 0.9 }],
        })
      ),
    });
    let hydrationCall = 0;
    deps.getSignals = vi.fn(async () => {
      hydrationCall += 1;
      // Only the provenance preflight call (call 1) should ever run — the malformed
      // citation id must never reach a second getSignals call.
      return hydrationCall === 1 ? [citationSignal()] : [];
    });
    await runRagEval([], deps);
    expect(hydrationCall).toBe(1);
    expect(deps.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [expect.objectContaining({ failure_code: "citation_not_found" })],
      })
    );
  });

  it("normalizes duplicate citations to unique chunks_used before judging", async () => {
    let call = 0;
    const deps = baseDeps({
      runChatAgent: vi.fn(async () =>
        answerResult({
          citations: [
            { claim: "a", chunk_id: SIGNAL_1, source: "pricing", similarity_score: 0.9 },
            { claim: "b", chunk_id: SIGNAL_1, source: "pricing", similarity_score: 0.8 },
          ],
        })
      ),
      getSignals: vi.fn(async () => {
        call += 1;
        return [citationSignal()];
      }),
    });
    await runRagEval([], deps);
    const judgeCall = (deps.judge as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(judgeCall.citations).toHaveLength(1);
    const persistCall = (deps.persist as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(persistCall.results[0].chunks_used).toEqual([SIGNAL_1]);
  });
});

describe("runRagEval — judge scoring and aggregate math", () => {
  it("computes the trusted final score as min(correctness, groundedness)", async () => {
    const deps = baseDeps({ judge: vi.fn(async () => judgeResult({ correctness_score: 0.9, groundedness_score: 0.4 })) });
    await runRagEval([], deps);
    const persistCall = (deps.persist as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(persistCall.results[0].faithfulness_score).toBe(0.4);
  });

  it("passes at exactly the threshold boundary", async () => {
    const deps = baseDeps({ judge: vi.fn(async () => judgeResult({ correctness_score: 0.75, groundedness_score: 0.75 })) });
    const outcome = await runRagEval(["--threshold=0.75"], deps);
    expectCompletion(outcome);
    expect(outcome.gate).toBe("passed");
  });

  it("aborts the whole evaluation on a malformed judge result", async () => {
    const deps = baseDeps({ judge: vi.fn(async () => ({ score: "not valid" })) });
    await expect(runRagEval([], deps)).rejects.toThrow();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("aborts the whole evaluation on a judge rejection", async () => {
    const deps = baseDeps({ judge: vi.fn(async () => { throw new Error("judge unavailable"); }) });
    await expect(runRagEval([], deps)).rejects.toThrow();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("aggregates [1, 0.5] to exactly 0.75 and passes at the floor (hand-checked)", async () => {
    const caseA = testCase({ id: uuid("601") });
    const caseB = testCase({ id: uuid("602") });
    let call = 0;
    const deps = baseDeps({
      listCases: vi.fn(async () => [caseA, caseB]),
      judge: vi.fn(async () => {
        call += 1;
        return call === 1 ? judgeResult({ correctness_score: 1, groundedness_score: 1 })
          : judgeResult({ correctness_score: 0.5, groundedness_score: 0.5 });
      }),
    });
    const outcome = await runRagEval(["--threshold=0.75"], deps);
    expectCompletion(outcome);
    expect(outcome.summary.faithfulness_score).toBe(0.75);
    expect(outcome.gate).toBe("passed");
  });

  it("aggregates [0.74, 0.75] to exactly 0.745 and fails (hand-checked)", async () => {
    const caseA = testCase({ id: uuid("601") });
    const caseB = testCase({ id: uuid("602") });
    let call = 0;
    const deps = baseDeps({
      listCases: vi.fn(async () => [caseA, caseB]),
      judge: vi.fn(async () => {
        call += 1;
        return call === 1 ? judgeResult({ correctness_score: 0.74, groundedness_score: 0.74 })
          : judgeResult({ correctness_score: 0.75, groundedness_score: 0.75 });
      }),
    });
    const outcome = await runRagEval(["--threshold=0.75"], deps);
    expectCompletion(outcome);
    expect(outcome.summary.faithfulness_score).toBeCloseTo(0.745, 10);
    expect(outcome.gate).toBe("failed");
  });
});

describe("runRagEval — artifact and persistence ordering", () => {
  it("writes a deterministic sanitized artifact only after persistence commits", async () => {
    const events: string[] = [];
    const deps = baseDeps({
      persist: vi.fn(async (input) => {
        events.push("persist");
        return {
          id: "run-1",
          summary: {
            run_at: input.run_at.toISOString(), total_questions: 1, passed: 1, failed: 0,
            faithfulness_score: 0.9, threshold: input.threshold, ci_triggered: input.ci_triggered,
            git_commit: input.git_commit,
          },
        };
      }),
      writeArtifact: vi.fn(async (_path, content) => {
        events.push("artifact");
        expect(content).not.toContain("What is Acme's pricing?");
        expect(content).not.toContain("Acme charges $10/month for its Pro plan.");
      }),
    });

    const outcome = await runRagEval([], deps);
    expectCompletion(outcome);
    expect(events).toEqual(["persist", "artifact"]);
    expect(outcome.output_path).toBe("rag-eval-results-2026-03-01T00-00-00-000Z.json");
    const [, content] = (deps.writeArtifact as ReturnType<typeof vi.fn>).mock.calls[0];
    const artifact = JSON.parse(content);
    expect(artifact).toMatchObject({
      schema_version: 1,
      run_at: "2026-03-01T00:00:00.000Z",
      git_commit: "abc123",
      competitor_filter: null,
      gate: "passed",
    });
    expect(artifact.results[0].chunks_used).toEqual([SIGNAL_1]);
  });

  it("does not write an artifact when persistence fails", async () => {
    const deps = baseDeps({ persist: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(runRagEval([], deps)).rejects.toThrow();
    expect(deps.writeArtifact).not.toHaveBeenCalled();
  });

  it("reports a safe operational failure when the artifact write fails after a successful commit", async () => {
    const deps = baseDeps({ writeArtifact: vi.fn(async () => { throw new Error("EEXIST"); }) });
    await expect(runRagEval([], deps)).rejects.toThrow(/persisted/i);
  });

  it("respects an explicit --output path", async () => {
    const deps = baseDeps();
    const outcome = await runRagEval(["--output=/tmp/custom-rag-eval.json"], deps);
    expectCompletion(outcome);
    expect(outcome.output_path).toBe("/tmp/custom-rag-eval.json");
  });
});

describe("runRagEval — CI prerequisite skip", () => {
  it("skips with missing_prerequisites before touching any dependency when --ci=true and CI=true", async () => {
    const originalCi = process.env.CI;
    const saved = Object.fromEntries(
      ["DATABASE_URL", "REDIS_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "COHERE_API_KEY", "PINECONE_API_KEY"].map(
        (name) => [name, process.env[name]]
      )
    );
    process.env.CI = "true";
    for (const name of Object.keys(saved)) delete process.env[name];

    try {
      const outcome = await runRagEval(["--ci=true"]);
      expect(outcome).toMatchObject({ status: "skipped", reason: "missing_prerequisites" });
      if (outcome.status === "skipped") {
        expect(outcome.missing).toEqual(expect.arrayContaining(["DATABASE_URL", "OPENAI_API_KEY"]));
      }
    } finally {
      if (originalCi === undefined) delete process.env.CI; else process.env.CI = originalCi;
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });

  it("never returns skip fields alongside a passing/failing summary", async () => {
    const deps = baseDeps();
    const outcome = await runRagEval([], deps);
    expect(outcome).not.toHaveProperty("reason");
    expect(outcome).not.toHaveProperty("missing");
  });

  it("does not skip a plain manual run even with all prerequisites missing (ci not requested)", async () => {
    const deps = baseDeps();
    const outcome = await runRagEval([], deps);
    expect(outcome.status).not.toBe("skipped");
  });
});

describe("runRagEvalCli", () => {
  it("exits 1 on invalid arguments without printing to stdout", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const exitCode = await runRagEvalCli(["--threshold=0.1"], { stdout, stderr });
    expect(exitCode).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
  });
});
