import { describe, expect, it, vi } from "vitest";
import { parseRagEvalSeedDataset, runSeedRagEval, type SeedRagEvalDeps } from "../../scripts/seed-rag-eval";

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
    ["unknown top-level key", JSON.stringify({ schema_version: 1, cases: [CASE], extra: true })],
    ["empty cases", JSON.stringify({ schema_version: 1, cases: [] })],
    ["noncanonical UUID", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, id: "ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF" }] })],
    ["surrounding question whitespace", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, question: " question" }] })],
    ["empty answer", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, expected_answer: "" }] })],
    ["unknown case key", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, extra: true }] })],
    ["repeated support id", JSON.stringify({ schema_version: 1, cases: [{ ...CASE, supporting_signal_ids: [CASE.supporting_signal_ids[0], CASE.supporting_signal_ids[0]] }] })],
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
});
