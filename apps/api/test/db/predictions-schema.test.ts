import { describe, it, expect } from "vitest";
import { predictionsTable } from "@/db/schema";
import { PREDICTION_STATUSES, ResolutionCriteriaSchema } from "@signal/shared";

describe("predictions schema", () => {
  it("exposes the five lifecycle statuses", () => {
    expect(PREDICTION_STATUSES).toEqual(["open", "hit", "miss", "unresolved", "void"]);
  });

  it("accepts each machine-checkable resolution criteria kind", () => {
    expect(
      ResolutionCriteriaSchema.safeParse({
        kind: "signal_match",
        all_of: ["postgres"],
        sources: ["github"],
      }).success
    ).toBe(true);
    expect(
      ResolutionCriteriaSchema.safeParse({
        kind: "github_release",
        repo: "acme/next",
        mentions: ["postgres"],
      }).success
    ).toBe(true);
    expect(
      ResolutionCriteriaSchema.safeParse({ kind: "pricing_change", direction: "increase" }).success
    ).toBe(true);
  });

  it("refuses criteria with no checkable predicate", () => {
    // The whole point of the ledger is that a claim can be settled without a
    // human re-reading it. Free text with no predicate is a claim nothing can
    // resolve, so it must not be storable in the first place.
    expect(
      ResolutionCriteriaSchema.safeParse({ kind: "vibes", note: "they'll ship soon" }).success
    ).toBe(false);
    expect(
      ResolutionCriteriaSchema.safeParse({ kind: "signal_match", all_of: [], sources: ["github"] })
        .success
    ).toBe(false);
    expect(
      ResolutionCriteriaSchema.safeParse({ kind: "signal_match", all_of: ["x"], sources: [] })
        .success
    ).toBe(false);
  });

  it("rejects a source the collectors cannot produce", () => {
    expect(
      ResolutionCriteriaSchema.safeParse({
        kind: "signal_match",
        all_of: ["postgres"],
        sources: ["carrier-pigeon"],
      }).success
    ).toBe(false);
  });

  it("names the columns the resolver sweep and the scorecard depend on", () => {
    const columns = Object.keys(predictionsTable);
    for (const column of [
      "workspace_id",
      "competitor_id",
      "statement",
      "pattern_type",
      "probability",
      "resolution_criteria",
      "horizon_days",
      "resolves_at",
      "evidence_signal_ids",
      "evidence_count",
      "status",
      "resolved_at",
      "resolution_note",
      "resolution_evidence_urls",
      "brier_score",
    ]) {
      expect(columns).toContain(column);
    }
  });
});
