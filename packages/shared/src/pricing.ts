import { z } from "zod";

// Stored in pricing_baselines.snapshot (jsonb) — a full capture of a competitor's
// pricing page at one point in time, produced by collectors/pricing.ts.
export const PricingTierSchema = z.object({
  name: z.string(),
  price: z.number().nullable(),
  billing: z.enum(["monthly", "annual", "custom"]).optional(),
  features: z.array(z.string()).default([]),
});
export type PricingTier = z.infer<typeof PricingTierSchema>;

export const PricingSnapshotSchema = z.object({
  tiers: z.array(PricingTierSchema),
});
export type PricingSnapshot = z.infer<typeof PricingSnapshotSchema>;

// Stored in pricing_diffs.diff (jsonb) — the structured comparison between two
// consecutive PricingSnapshots for the same competitor.
export const PricingTierChangeSchema = z.object({
  name: z.string(),
  field: z.enum(["price", "billing", "features"]),
  old_value: z.unknown(),
  new_value: z.unknown(),
});
export type PricingTierChange = z.infer<typeof PricingTierChangeSchema>;

export const PricingDiffSchema = z.object({
  added_tiers: z.array(PricingTierSchema),
  removed_tiers: z.array(PricingTierSchema),
  changed_tiers: z.array(PricingTierChangeSchema),
  significance: z.enum(["minor", "moderate", "critical"]),
});
export type PricingDiff = z.infer<typeof PricingDiffSchema>;
