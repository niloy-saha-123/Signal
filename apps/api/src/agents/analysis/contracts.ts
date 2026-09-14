// Side-effect-free structured-output contracts shared by the production
// analysis nodes and the prompt-regression evaluator. Keeping these schemas
// here prevents evaluation from drifting from the boundaries used for live
// model output, while avoiding importing database/model clients at CLI parse
// time.
import { z } from "zod";

export const HiringIntentSchema = z.object({
  summary: z.string(),
  intent_level: z.enum(["low", "medium", "high"]),
});

export const SentimentClustersSchema = z.object({
  summary: z.string(),
  new_complaints: z.array(z.string()),
  chronic_complaints: z.array(z.string()),
});

export const PricingChangeSchema = z.object({
  summary: z.string(),
  old_price: z.string().nullable(),
  new_price: z.string().nullable(),
});

export const PatternsSchema = z.object({
  summary: z.string(),
  trend: z.enum(["increasing", "decreasing", "stable"]),
});

export const VulnerabilityWindowSchema = z.object({
  window_open: z.boolean(),
  reasoning: z.string(),
});

export const VulnerabilityPositioningSchema = z.object({
  positioning_copy: z.string(),
});

export const VulnerabilityResultSchema = z
  .object({
    summary: z.string(),
    window_open: z.boolean(),
    positioning_copy: z.string(),
  })
  .superRefine((value, context) => {
    if (value.window_open && value.positioning_copy.trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An open vulnerability window requires non-empty positioning_copy",
        path: ["positioning_copy"],
      });
    }
    if (!value.window_open && value.positioning_copy.length !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A closed vulnerability window requires empty positioning_copy",
        path: ["positioning_copy"],
      });
    }
  });

export const AnalysisDecisionSchema = z.object({
  action: z.enum(["alert", "digest", "suppress"]),
  reason: z.string(),
});
