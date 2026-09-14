import { describe, expect, it, vi } from "vitest";
import * as seedScript from "../../scripts/seed-rag-eval";
import {
  parseRagEvalSeedDataset,
  runSeedRagEval,
  runSeedRagEvalCli,
  type SeedRagEvalDeps,
} from "../../scripts/seed-rag-eval";

const CASE = {
  id: "11111111-1111-4111-8111-111111111111",
  competitor_id: "22222222-2222-4222-8222-222222222222",
  category: "general",
  question: "What is the curator's verified question?",
  expected_answer: "The curator's verified answer.",
  supporting_signal_ids: ["33333333-3333-4333-8333-333333333333"],
  confidence_level: "low",
} as const;

const DATASET = JSON.stringify({ schema_version: 1, cases: [CASE] });

function canonicalUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function structuralCase(index: number) {
  return {
    ...CASE,
    id: canonicalUuid(10_000 + index),
    question: `STRUCTURAL_TEST_ONLY_QUESTION_${index}`,
    expected_answer: `STRUCTURAL_TEST_ONLY_ANSWER_${index}`,
    supporting_signal_ids: [canonicalUuid(20_000 + index)],
  };
}

function dependencies(content = DATASET): SeedRagEvalDeps {
  return {
    readFile: vi.fn(async () => content),
    seedRagEvalDataset: vi.fn(async () => ({ inserted: 1, unchanged: 0 })),
  };
}

describe("parseRagEvalSeedDataset", () => {
  it("preserves a valid curator case byte-for-byte and in order", () => {
    expect(parseRagEvalSeedDataset(DATASET)).toEqual({ schema_version: 1, cases: [CASE] });
  });

  it.each([
    ["empty bytes", ""],
    ["whitespace bytes", "  \n"],
    ["malformed JSON", "{"],
    ["wrong version", JSON.stringify({ schema_version: 2, cases: [CASE] })],
    ["missing schema version", JSON.stringify({ cases: [CASE] })],
    ["missing cases", JSON.stringify({ schema_version: 1 })],
    ["unknown top-level key", JSON.stringify({ schema_version: 1, cases: [CASE], extra: true })],
    ["empty cases", JSON.stringify({ schema_version: 1, cases: [] })],
    ["noncanonical UUID", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, id: "ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF" }] })],
    ["surrounding question whitespace", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, question: " question" }] })],
    ["empty answer", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, expected_answer: "" }] })],
    ["unknown case key", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, extra: true }] })],
    ["repeated support id", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, supporting_signal_ids: [CASE.supporting_signal_ids[0], CASE.supporting_signal_ids[0]] }] })],
    ["non-string support ID", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, supporting_signal_ids: [42] }] })],
    ["malformed support ID", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, supporting_signal_ids: ["not-a-uuid"] }] })],
    ["surrounding answer whitespace", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, expected_answer: " answer" }] })],
    ["duplicate case id", JSON.stringify({ schema_version: 1, cases: [CASE, { ...CASE }] })],
  ])("rejects %s without repairing curator content", (_label, content) => {
    expect(() => parseRagEvalSeedDataset(content)).toThrow();
  });

  it("allows repeated wording under different stable IDs and preserves support order", () => {
    const second = {
      ...CASE,
      id: "44444444-4444-4444-8444-444444444444",
      supporting_signal_ids: [
        "55555555-5555-4555-8555-555555555555",
        "33333333-3333-4333-8333-333333333333",
      ],
    };
    expect(parseRagEvalSeedDataset(JSON.stringify({ schema_version: 1, cases: [CASE, second] }))).toEqual({
      schema_version: 1,
      cases: [CASE, second],
    });
  });

  it("accepts exact text and support bounds without normalizing them", () => {
    const supportIds = Array.from({ length: 100 }, (_, index) => canonicalUuid(index));
    const dataset = parseRagEvalSeedDataset(JSON.stringify({
      schema_version: 1,
      cases: [{
        ...CASE,
        question: "q".repeat(2_000),
        expected_answer: "a".repeat(20_000),
        supporting_signal_ids: supportIds,
      }],
    }));
    expect(dataset.cases[0]?.question).toHaveLength(2_000);
    expect(dataset.cases[0]?.expected_answer).toHaveLength(20_000);
    expect(dataset.cases[0]?.supporting_signal_ids).toEqual(supportIds);
  });

  it("rejects 101 independently valid unique support IDs", () => {
    const supportIds = Array.from({ length: 101 }, (_, index) => canonicalUuid(index));

    expect(() => parseRagEvalSeedDataset(JSON.stringify({
      schema_version: 1,
      cases: [{ ...CASE, supporting_signal_ids: supportIds }],
    }))).toThrow("RAG eval fixture failed validation");
  });

  it("accepts exactly 1,000 unique structural cases", () => {
    const cases = Array.from({ length: 1_000 }, (_, index) => structuralCase(index));

    expect(parseRagEvalSeedDataset(JSON.stringify({ schema_version: 1, cases })).cases).toHaveLength(1_000);
  });

  it("rejects 1,001 unique structural cases", () => {
    const cases = Array.from({ length: 1_001 }, (_, index) => structuralCase(index));

    expect(() => parseRagEvalSeedDataset(JSON.stringify({ schema_version: 1, cases }))).toThrow(
      "RAG eval fixture failed validation"
    );
  });

  it("uses a bounded value-free validation error for invalid curator text", () => {
    const sentinel = "CURATOR_ANSWER_MUST_NEVER_APPEAR";
    try {
      parseRagEvalSeedDataset(
        JSON.stringify({ schema_version: 1, cases: [{ ...CASE, expected_answer: ` ${sentinel}` }] })
      );
      throw new Error("expected parser to reject fixture");
    } catch (error) {
      expect(error).toMatchObject({ message: "RAG eval fixture failed validation" });
      expect(String(error)).not.toContain(sentinel);
    }
  });

  it.each([
    ["non-string UUID", { id: 42 }],
    ["unknown category", { category: "unknown" }],
    ["unknown confidence", { confidence_level: "unknown" }],
    ["empty support list", { supporting_signal_ids: [] }],
    ["question above 2,000 characters", { question: "q".repeat(2_001) }],
    ["answer above 20,000 characters", { expected_answer: "a".repeat(20_001) }],
  ])("rejects %s with the same bounded usage error", (_label, override) => {
    expect(() => parseRagEvalSeedDataset(JSON.stringify({
      schema_version: 1,
      cases: [{ ...CASE, ...override }],
    }))).toThrow("RAG eval fixture failed validation");
  });
});

describe("runSeedRagEval", () => {
  it("rejects invalid CLI options before reading or loading a repository", async () => {
    const deps = dependencies();

    for (const argv of [[], ["--file="], ["--file=x", "--file=y"], ["--unknown=x"], ["fixture"]]) {
      await expect(runSeedRagEval(argv, deps)).rejects.toThrow();
    }

    expect(deps.readFile).not.toHaveBeenCalled();
    expect(deps.seedRagEvalDataset).not.toHaveBeenCalled();
  });

  it("validates the full fixture before persisting, then passes exact cases and stable counts", async () => {
    const invalid = dependencies("not JSON");
    await expect(runSeedRagEval(["--file=/fixture.json"], invalid)).rejects.toThrow("valid JSON");
    expect(invalid.seedRagEvalDataset).not.toHaveBeenCalled();

    const deps = dependencies();
    await expect(runSeedRagEval(["--file=/fixture.json"], deps)).resolves.toEqual({
      schema_version: 1, total: 1, inserted: 1, unchanged: 0,
    });
    expect(deps.readFile).toHaveBeenCalledWith("/fixture.json");
    expect(deps.seedRagEvalDataset).toHaveBeenCalledWith([CASE]);
  });

  it("refuses inconsistent repository counts instead of publishing misleading output", async () => {
    const deps = dependencies();
    deps.seedRagEvalDataset = vi.fn(async () => ({ inserted: 2, unchanged: 0 }));
    await expect(runSeedRagEval(["--file=/fixture.json"], deps)).rejects.toThrow("inconsistent counts");
  });

  it("rejects non-integer repository counts rather than publishing fractional success", async () => {
    const deps = dependencies();
    deps.seedRagEvalDataset = vi.fn(async () => ({ inserted: 0.5, unchanged: 0.5 }));
    await expect(runSeedRagEval(["--file=/fixture.json"], deps)).rejects.toThrow("inconsistent counts");
  });

  it("does not expose a fixture path when its reader fails", async () => {
    const deps = dependencies();
    deps.readFile = vi.fn(async () => { throw new Error("ENOENT: /private/curated-fixture.json"); });
    await expect(runSeedRagEval(["--file=/private/curated-fixture.json"], deps)).rejects.toThrow(
      "Unable to read RAG eval fixture"
    );
  });

  it("sanitizes unexpected repository failures while retaining safe domain errors", async () => {
    const sentinel = "CURATOR_ANSWER_MUST_NEVER_APPEAR";
    const deps = dependencies();
    deps.seedRagEvalDataset = vi.fn(async () => {
      throw new Error(`driver failure params=[${sentinel}] postgresql://secret@db`);
    });
    await expect(runSeedRagEval(["--file=/fixture.json"], deps)).rejects.toThrow(
      "RAG eval seed failed"
    );
  });

  it("keeps positional arguments and runtime failure details out of executable stderr", async () => {
    const runner = Reflect.get(seedScript, "runSeedRagEvalCli") as undefined | ((
      argv: string[],
      readFile: (path: string) => Promise<string>,
      loadRuntime: () => Promise<{ seedRagEvalDataset: SeedRagEvalDeps["seedRagEvalDataset"]; cleanup: () => Promise<void> }>,
      io: { stdout: (message: string) => void; stderr: (message: string) => void }
    ) => Promise<number>);
    const stderr = vi.fn();
    const loadRuntime = vi.fn(async () => ({
      seedRagEvalDataset: vi.fn(async () => ({ inserted: 1, unchanged: 0 })),
      cleanup: vi.fn(async () => undefined),
    }));

    await expect(
      runner!(["/private/CURATOR_PATH"], async () => DATASET, loadRuntime, { stdout: vi.fn(), stderr })
    ).resolves.toBe(1);
    expect(stderr.mock.calls.join(" ")).not.toContain("CURATOR_PATH");
    expect(loadRuntime).not.toHaveBeenCalled();
  });

  it("sanitizes executable reader failures before a runtime is opened", async () => {
    const sentinel = "CURATOR_READER_PARAMS_MUST_NEVER_APPEAR";
    const cleanup = vi.fn(async () => undefined);
    const loadRuntime = vi.fn(async () => ({
      seedRagEvalDataset: async () => ({ inserted: 1, unchanged: 0 }),
      cleanup,
    }));
    const stdout = vi.fn();
    const stderr = vi.fn();

    await expect(
      runSeedRagEvalCli(
        ["--file=/private/curator-fixture.json"],
        async () => { throw new Error(`driver read params=[${sentinel}] /private/curator-fixture.json`); },
        loadRuntime,
        { stdout, stderr }
      )
    ).resolves.toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(stderr.mock.calls.join(" ")).not.toMatch(/CURATOR_READER|params|driver|fixture\.json|private/);
  });

  it("loads and closes the default runtime only after valid fixture parsing, including repository failure", async () => {
    const cleanup = vi.fn(async () => undefined);
    const seedRagEvalDataset = vi.fn(async () => {
      throw new Error("driver params=[CURATOR_ANSWER_MUST_NEVER_APPEAR]");
    });
    const loadRuntime = vi.fn(async () => ({ seedRagEvalDataset, cleanup }));
    const stdout = vi.fn();
    const stderr = vi.fn();

    await expect(
      runSeedRagEvalCli(["--file=/safe.json"], async () => DATASET, loadRuntime, { stdout, stderr })
    ).resolves.toBe(1);
    expect(loadRuntime).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.mock.calls.join(" ")).not.toContain("CURATOR_ANSWER_MUST_NEVER_APPEAR");
  });

  it("sanitizes a lazy runtime loader failure without attempting cleanup", async () => {
    const sentinel = "CURATOR_LOADER_PARAMS_MUST_NEVER_APPEAR";
    const loadRuntime = vi.fn(async () => {
      throw new Error(`sql=SELECT params=[${sentinel}] /private/fixture.json`);
    });
    const stderr = vi.fn();

    await expect(
      runSeedRagEvalCli(["--file=/safe.json"], async () => DATASET, loadRuntime, {
        stdout: vi.fn(),
        stderr,
      })
    ).resolves.toBe(1);
    expect(loadRuntime).toHaveBeenCalledOnce();
    expect(stderr.mock.calls.join(" ")).not.toMatch(/CURATOR_LOADER|params|SELECT|fixture\.json/);
  });

  it("sanitizes cleanup failure while changing the executable exit to one", async () => {
    const sentinel = "CURATOR_CLEANUP_PARAMS_MUST_NEVER_APPEAR";
    const cleanup = vi.fn(async () => {
      throw new Error(`close failed params=[${sentinel}] /private/fixture.json`);
    });
    const stderr = vi.fn();

    await expect(
      runSeedRagEvalCli(
        ["--file=/safe.json"],
        async () => DATASET,
        async () => ({
          seedRagEvalDataset: async () => ({ inserted: 1, unchanged: 0 }),
          cleanup,
        }),
        { stdout: vi.fn(), stderr }
      )
    ).resolves.toBe(1);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(stderr.mock.calls.join(" ")).not.toMatch(/CURATOR_CLEANUP|params|fixture\.json/);
  });

  it("does not load or clean a runtime when complete fixture validation fails", async () => {
    const cleanup = vi.fn(async () => undefined);
    const loadRuntime = vi.fn(async () => ({
      seedRagEvalDataset: async () => ({ inserted: 1, unchanged: 0 }),
      cleanup,
    }));

    await expect(
      runSeedRagEvalCli(["--file=/safe.json"], async () => "{", loadRuntime, {
        stdout: vi.fn(),
        stderr: vi.fn(),
      })
    ).resolves.toBe(1);
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("prints one stable success summary and cleans a successfully loaded runtime once", async () => {
    const cleanup = vi.fn(async () => undefined);
    const stdout = vi.fn();

    await expect(
      runSeedRagEvalCli(
        ["--file=/safe.json"],
        async () => DATASET,
        async () => ({
          seedRagEvalDataset: async () => ({ inserted: 1, unchanged: 0 }),
          cleanup,
        }),
        { stdout, stderr: vi.fn() }
      )
    ).resolves.toBe(0);
    expect(JSON.parse(stdout.mock.calls[0]?.[0] ?? "")).toEqual({
      schema_version: 1,
      total: 1,
      inserted: 1,
      unchanged: 0,
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
