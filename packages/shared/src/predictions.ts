// Zod schemas for the prediction ledger — the dated, falsifiable forecasts Signal
// makes about a competitor, and the machine-checkable criteria that later settle
// them.
//
// The ledger exists because an unresolved prediction is indistinguishable from a
// guess. Every incumbent in this category emits confident-sounding forward claims
// and never revisits them, which is why "too much noise" is the one complaint
// every competitive-intelligence tool's users share. A prediction that must later
// be resolved is expensive to make, so the system is forced to be selective — the
// selectivity is the product, and these schemas are where it is enforced.

import { z } from "zod";
import { SignalSourceSchema } from "./signals";

// open       — made, not yet due
// hit / miss — resolved against real evidence; these are the only two that score
// unresolved — the window closed with no evidence either way. Carries no
//              information about accuracy, so it is excluded from scoring rather
//              than counted as a miss: abstaining must not look like being wrong.
// void       — a human marked it moot (competitor acquired, product cancelled).
export const PREDICTION_STATUSES = ["open", "hit", "miss", "unresolved", "void"] as const;
export const PredictionStatusSchema = z.enum(PREDICTION_STATUSES);
export type PredictionStatus = (typeof PREDICTION_STATUSES)[number];

export const PREDICTION_PATTERN_TYPES = [
  "product_launch",
  "pricing_change",
  "upmarket_pivot",
  "platform_expansion",
  "hiring_surge",
  "deprecation",
] as const;
export const PredictionPatternTypeSchema = z.enum(PREDICTION_PATTERN_TYPES);
export type PredictionPatternType = (typeof PREDICTION_PATTERN_TYPES)[number];

// How a prediction gets settled without a human re-reading it. `kind` selects the
// resolver strategy, and each variant carries everything that strategy needs.
//
// A forecast that cannot state one of these is not a forecast — it is an opinion —
// and the discriminated union is what stops one being stored. This is deliberately
// narrow: three checkable shapes beat a free-text field that always parses and
// never resolves.
export const ResolutionCriteriaSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("signal_match"),
    // Every term must appear across the competitor's signals collected inside the
    // prediction's window. `all_of` rather than `any_of`: a single common word
    // matching is how a resolver talks itself into a hit.
    all_of: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
    sources: z.array(SignalSourceSchema).min(1).max(6),
  }),
  z.object({
    kind: z.literal("github_release"),
    repo: z.string().trim().min(1).max(140),
    // Matched case-insensitively against the release name, tag and body.
    mentions: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  }),
  z.object({
    kind: z.literal("pricing_change"),
    direction: z.enum(["increase", "decrease", "any"]),
  }),
]);
export type ResolutionCriteria = z.infer<typeof ResolutionCriteriaSchema>;

export const PREDICTION_STATEMENT_MIN_LENGTH = 20;
export const PREDICTION_STATEMENT_MAX_LENGTH = 300;

// The floor and ceiling on a stated probability. A model that emits 0 or 1 is
// claiming certainty it does not have; a ledger that accepts those produces an
// uninformative Brier score and a product that lies about how sure it is.
export const PREDICTION_PROBABILITY_MIN = 0.05;
export const PREDICTION_PROBABILITY_MAX = 0.95;

export const PREDICTION_HORIZON_MIN_DAYS = 7;
export const PREDICTION_HORIZON_MAX_DAYS = 180;

// One row of the `predictions` table, as it crosses the API boundary.
export const PredictionSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  competitor_id: z.string().uuid(),
  run_id: z.string().uuid().nullable(),
  statement: z
    .string()
    .trim()
    .min(PREDICTION_STATEMENT_MIN_LENGTH)
    .max(PREDICTION_STATEMENT_MAX_LENGTH),
  pattern_type: PredictionPatternTypeSchema,
  probability: z.number().min(PREDICTION_PROBABILITY_MIN).max(PREDICTION_PROBABILITY_MAX),
  resolution_criteria: ResolutionCriteriaSchema,
  horizon_days: z.number().int().min(PREDICTION_HORIZON_MIN_DAYS).max(PREDICTION_HORIZON_MAX_DAYS),
  resolves_at: z.string().datetime(),
  evidence_signal_ids: z.array(z.string().uuid()),
  evidence_count: z.number().int().nonnegative(),
  status: PredictionStatusSchema,
  resolved_at: z.string().datetime().nullable(),
  resolution_note: z.string().nullable(),
  resolution_evidence_urls: z.array(z.string()),
  brier_score: z.number().min(0).max(1).nullable(),
  created_at: z.string().datetime(),
});
export type Prediction = z.infer<typeof PredictionSchema>;
