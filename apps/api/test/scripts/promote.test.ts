import { describe, expect, it, vi } from "vitest";
import {
  passesPromotionGate,
  runPromoteCli,
  twoProportionZTest,
  type PromotePromptVersionInput,
  type PromotionResult,
  type PromptPromotionDeps,
} from "../../scripts/promote";

const promotedResult: PromotionResult = {
  agent_name: "intent_analyzer",
  candidate_version: 2,
  active_version: 1,
  promoted: true,
  reason: "promoted",
  candidate_counts: { passed: 95, total: 100 },
  active_counts: { passed: 70, total: 100 },
  statistics: {
    candidate_accuracy: 0.95,
    active_accuracy: 0.7,
    pooled_proportion: 0.825,
    standard_error: 0.05373546335898502,
    z_score: 4.652413422057387,
    p_value: 0.000003280719967469147,
  },
};

describe("twoProportionZTest", () => {
  it("matches a hand-calculated two-sided uplift test", () => {
    const result = twoProportionZTest(90, 100, 70, 100);

    expect(result.candidate_accuracy).toBe(0.9);
    expect(result.active_accuracy).toBe(0.7);
    expect(result.pooled_proportion).toBe(0.8);
    expect(result.standard_error).toBeCloseTo(0.0565685425, 9);
    expect(result.z_score).toBeCloseTo(3.535533906, 9);
    expect(result.p_value).toBeCloseTo(0.0004069, 6);
  });

  it("returns finite equality semantics when both samples have zero variance", () => {
    expect(twoProportionZTest(100, 100, 50, 50)).toEqual({
      candidate_accuracy: 1,
      active_accuracy: 1,
      pooled_proportion: 1,
      standard_error: 0,
      z_score: 0,
      p_value: 1,
    });
  });

  it("keeps regression direction and non-significant uplift honest", () => {
    expect(twoProportionZTest(40, 100, 60, 100).z_score).toBeLessThan(0);
    expect(twoProportionZTest(51, 100, 50, 100).p_value).toBeGreaterThan(0.05);
  });

  it.each([
    [Number.NaN, 10, 5, 10],
    [Number.POSITIVE_INFINITY, 10, 5, 10],
    [1.5, 10, 5, 10],
    [1, 0, 5, 10],
    [-1, 10, 5, 10],
    [11, 10, 5, 10],
    [1, Number.MAX_SAFE_INTEGER + 1, 5, 10],
  ])("rejects invalid counts instead of coercing them: %j", (...counts) => {
    expect(() => twoProportionZTest(...counts)).toThrow();
  });
});

describe("passesPromotionGate", () => {
  const base = {
    candidate_accuracy: 0.9,
    active_accuracy: 0.8,
    pooled_proportion: 0.85,
    standard_error: 0.1,
    z_score: 1,
    p_value: 0.049,
  };

  it("requires both strict improvement and p < 0.05", () => {
    expect(passesPromotionGate(base)).toBe(true);
    expect(passesPromotionGate({ ...base, candidate_accuracy: 0.8 })).toBe(false);
    expect(passesPromotionGate({ ...base, candidate_accuracy: 0.7 })).toBe(false);
    expect(passesPromotionGate({ ...base, p_value: 0.05 })).toBe(false);
    expect(passesPromotionGate({ ...base, p_value: 0.2 })).toBe(false);
  });
});

describe("runPromoteCli", () => {
  const input: PromotePromptVersionInput = {
    agentName: "intent_analyzer",
    candidateVersion: 2,
    activeVersion: 1,
    candidate: { passed: 95, total: 100 },
    active: { passed: 70, total: 100 },
  };

  function dependencies(): PromptPromotionDeps {
    return { promotePromptVersion: vi.fn(async () => promotedResult) };
  }

  it("passes explicit audit counts to promotion and prints stable safe JSON", async () => {
    const deps = dependencies();
    const cleanup = vi.fn(async () => undefined);
    const loadRuntime = vi.fn(async () => ({ deps, cleanup }));
    const stdout = vi.fn();
    const stderr = vi.fn();

    await expect(
      runPromoteCli(
        [
          "--agent-name=intent_analyzer",
          "--candidate-version=2",
          "--active-version=1",
          "--candidate-passed=95",
          "--candidate-total=100",
          "--active-passed=70",
          "--active-total=100",
        ],
        loadRuntime,
        { stdout, stderr }
      )
    ).resolves.toBe(0);

    expect(deps.promotePromptVersion).toHaveBeenCalledWith(input);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(stderr).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.mock.calls[0][0])).toEqual(promotedResult);
  });

  it("treats an honest non-promotion as successful output", async () => {
    const result = {
      ...promotedResult,
      promoted: false as const,
      reason: "not-significant" as const,
    };
    const deps = { promotePromptVersion: vi.fn(async () => result) };
    const stdout = vi.fn();

    await expect(
      runPromoteCli(
        [
          "--agent-name=intent_analyzer",
          "--candidate-version=2",
          "--active-version=1",
          "--candidate-passed=71",
          "--candidate-total=100",
          "--active-passed=70",
          "--active-total=100",
        ],
        async () => ({ deps, cleanup: async () => undefined }),
        { stdout, stderr: vi.fn() }
      )
    ).resolves.toBe(0);
    expect(JSON.parse(stdout.mock.calls[0][0]).promoted).toBe(false);
  });

  it.each([
    ["--candidate-version=0"],
    ["--active-version=0"],
    ["--candidate-passed=-1"],
    ["--candidate-passed="],
    ["--candidate-passed=1.5"],
    ["--candidate-total=0"],
    ["--candidate-passed=11", "--candidate-total=10"],
    ["--active-passed=11", "--active-total=10"],
    ["--active-total=9007199254740992"],
    ["--extra=x"],
  ])("rejects invalid CLI counts before opening database resources: %j", async (...replacements) => {
    const base = [
      "--agent-name=intent_analyzer",
      "--candidate-version=2",
      "--active-version=1",
      "--candidate-passed=9",
      "--candidate-total=10",
      "--active-passed=7",
      "--active-total=10",
    ];
    const replacedKeys = new Set(replacements.map((item) => item.slice(0, item.indexOf("="))));
    const argv = [
      ...base.filter((item) => !replacedKeys.has(item.slice(0, item.indexOf("=")))),
      ...replacements,
    ];
    const loadRuntime = vi.fn();

    await expect(
      runPromoteCli(argv, loadRuntime, { stdout: vi.fn(), stderr: vi.fn() })
    ).resolves.toBe(1);
    expect(loadRuntime).not.toHaveBeenCalled();
  });

  it("reports a database failure safely and still closes opened resources", async () => {
    const cleanup = vi.fn(async () => undefined);
    const stderr = vi.fn();
    const deps = dependencies();
    deps.promotePromptVersion = vi.fn(async () => {
      throw new Error("postgresql://secret@database/prompt swap failed");
    });

    await expect(
      runPromoteCli(
        [
          "--agent-name=intent_analyzer",
          "--candidate-version=2",
          "--active-version=1",
          "--candidate-passed=95",
          "--candidate-total=100",
          "--active-passed=70",
          "--active-total=100",
        ],
        async () => ({ deps, cleanup }),
        { stdout: vi.fn(), stderr }
      )
    ).resolves.toBe(1);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(stderr.mock.calls[0][0]).not.toContain("secret@database");
  });
});
