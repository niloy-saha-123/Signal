import { describe, it, expect } from "vitest";
import { PricingSnapshotSchema, PricingDiffSchema } from "./pricing";

describe("PricingSnapshotSchema", () => {
  it("accepts a snapshot with multiple tiers", () => {
    const result = PricingSnapshotSchema.safeParse({
      tiers: [
        { name: "Starter", price: 29, billing: "monthly", features: ["1 seat", "Email support"] },
        { name: "Growth", price: 99, billing: "monthly", features: ["5 seats"] },
        { name: "Enterprise", price: null, billing: "custom", features: ["Unlimited seats"] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a tier with invalid billing enum", () => {
    const result = PricingSnapshotSchema.safeParse({
      tiers: [
        { name: "Starter", price: 29, billing: "weekly", features: ["1 seat"] },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("PricingDiffSchema", () => {
  it("accepts a diff marked critical", () => {
    const result = PricingDiffSchema.safeParse({
      added_tiers: [],
      removed_tiers: [],
      changed_tiers: [{ name: "Growth", field: "price", old_value: 99, new_value: 129 }],
      significance: "critical",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a significance value outside the DB CHECK constraint", () => {
    const result = PricingDiffSchema.safeParse({
      added_tiers: [],
      removed_tiers: [],
      changed_tiers: [],
      significance: "huge",
    });
    expect(result.success).toBe(false);
  });
});
