import { describe, it, expect } from "vitest";
import { AlertDetailSchema, AnalysisDecisionSchema } from "@/agents/analysis/contracts";

function validDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    pattern: "Aggressive hiring surge + open vulnerability window",
    interpretation: "Hiring for 5 senior AEs while support quality regresses — a window to win deals now.",
    evidence: [
      { type: "hiring", summary: "5 senior AE postings opened this week." },
      { type: "vulnerability", summary: "Support regression widened the window." },
    ],
    recommended_actions: [{ action: "Brief sales on the support regression talking point." }],
    ...overrides,
  };
}

describe("agents/analysis/contracts AlertDetailSchema", () => {
  it("parses a well-formed detail object", () => {
    expect(() => AlertDetailSchema.parse(validDetail())).not.toThrow();
  });

  it("requires pattern, interpretation, evidence, and recommended_actions", () => {
    for (const key of ["pattern", "interpretation", "evidence", "recommended_actions"]) {
      const detail = validDetail() as Record<string, unknown>;
      delete detail[key];
      expect(AlertDetailSchema.safeParse(detail).success).toBe(false);
    }
  });

  it("rejects an empty pattern", () => {
    expect(AlertDetailSchema.safeParse(validDetail({ pattern: "" })).success).toBe(false);
  });

  it("rejects a pattern longer than 200 characters", () => {
    expect(
      AlertDetailSchema.safeParse(validDetail({ pattern: "a".repeat(201) })).success
    ).toBe(false);
    expect(
      AlertDetailSchema.safeParse(validDetail({ pattern: "a".repeat(200) })).success
    ).toBe(true);
  });

  it("rejects an interpretation longer than 2000 characters", () => {
    expect(
      AlertDetailSchema.safeParse(validDetail({ interpretation: "a".repeat(2001) })).success
    ).toBe(false);
  });

  it("rejects more than 5 evidence items", () => {
    const evidence = Array.from({ length: 6 }, () => ({ type: "pattern", summary: "x" }));
    expect(AlertDetailSchema.safeParse(validDetail({ evidence })).success).toBe(false);
  });

  it("rejects an evidence item with an unknown type", () => {
    expect(
      AlertDetailSchema.safeParse(
        validDetail({ evidence: [{ type: "rumor", summary: "x" }] })
      ).success
    ).toBe(false);
  });

  it("rejects an evidence item with an empty summary", () => {
    expect(
      AlertDetailSchema.safeParse(
        validDetail({ evidence: [{ type: "pattern", summary: "" }] })
      ).success
    ).toBe(false);
  });

  it("rejects more than 5 recommended_actions", () => {
    const recommended_actions = Array.from({ length: 6 }, () => ({ action: "do something" }));
    expect(AlertDetailSchema.safeParse(validDetail({ recommended_actions })).success).toBe(
      false
    );
  });

  it("allows an empty evidence and recommended_actions list", () => {
    expect(
      AlertDetailSchema.safeParse(validDetail({ evidence: [], recommended_actions: [] }))
        .success
    ).toBe(true);
  });
});

describe("agents/analysis/contracts AnalysisDecisionSchema backward compatibility", () => {
  it("still parses a bare {action, reason} with no detail key at all — the historic agent_test_cases shape", () => {
    const result = AnalysisDecisionSchema.safeParse({ action: "digest", reason: "x" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.detail).toBeUndefined();
    }
  });

  it("parses action alert with a well-formed detail attached", () => {
    const result = AnalysisDecisionSchema.safeParse({
      action: "alert",
      reason: "Score jumped and a vulnerability window is open.",
      detail: validDetail(),
    });
    expect(result.success).toBe(true);
  });

  it("degrades a malformed detail to undefined rather than failing the whole decision", () => {
    // withStructuredOutput's parse is atomic over the whole object — before .catch(undefined)
    // was added, this failed the entire decision (action + reason too), which threw in
    // synthesisNode before the day's Signal Score was even persisted, and a BullMQ retry
    // re-ran all 5 upstream branch nodes' LLM calls for a failure purely in alert-copy
    // formatting. action/reason must still come through even when detail doesn't.
    const result = AnalysisDecisionSchema.safeParse({
      action: "alert",
      reason: "x",
      detail: { pattern: "" }, // fails AlertDetailSchema: empty pattern, missing every other field
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe("alert");
      expect(result.data.reason).toBe("x");
      expect(result.data.detail).toBeUndefined();
    }
  });

  it("degrades an over-length detail field to undefined the same way", () => {
    const result = AnalysisDecisionSchema.safeParse({
      action: "alert",
      reason: "x",
      detail: validDetail({ evidence: Array.from({ length: 6 }, () => ({ type: "pattern", summary: "x" })) }),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.detail).toBeUndefined();
  });
});
