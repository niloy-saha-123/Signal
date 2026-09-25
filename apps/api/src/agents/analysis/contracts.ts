// Side-effect-free structured-output contracts shared by the production
// analysis nodes and the prompt-regression evaluator. Keeping these schemas
// here prevents evaluation from drifting from the boundaries used for live
// model output, while avoiding importing database/model clients at CLI parse
// time.
import { z } from "zod";
import {
  PREDICTION_HORIZON_MAX_DAYS,
  PREDICTION_HORIZON_MIN_DAYS,
  PREDICTION_PROBABILITY_MAX,
  PREDICTION_PROBABILITY_MIN,
  PREDICTION_STATEMENT_MAX_LENGTH,
  PREDICTION_STATEMENT_MIN_LENGTH,
  PredictionPatternTypeSchema,
  ResolutionCriteriaSchema,
} from "@signal/shared";

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

// Bounds for the alert-detail fields below: same "this ends up in a Postgres jsonb column and
// gets rendered in the UI" reasoning as SYNTHESIS_INPUT_MAX_LENGTH (synthesis.ts) — a headline
// is short by nature, interpretation is real prose but still far below the 24k context-window
// bound, and evidence/recommended_actions are bounded lists, not open-ended dumps.
const ALERT_PATTERN_MAX_LENGTH = 200;
const ALERT_INTERPRETATION_MAX_LENGTH = 2_000;
const ALERT_EVIDENCE_MAX_ITEMS = 5;
const ALERT_EVIDENCE_SUMMARY_MAX_LENGTH = 300;
const ALERT_RECOMMENDED_ACTIONS_MAX_ITEMS = 5;
const ALERT_RECOMMENDED_ACTION_MAX_LENGTH = 300;

export const AlertEvidenceItemSchema = z.object({
  type: z.enum(["pattern", "hiring", "sentiment", "pricing", "vulnerability"]),
  summary: z.string().trim().min(1).max(ALERT_EVIDENCE_SUMMARY_MAX_LENGTH),
});

export const AlertRecommendedActionSchema = z.object({
  action: z.string().trim().min(1).max(ALERT_RECOMMENDED_ACTION_MAX_LENGTH),
});

// Purpose-written alert copy, produced by the same synthesis decision call as
// action/reason — not a second LLM call. Optional on AnalysisDecisionSchema below so a bare
// {action, reason} (the shape already stored in agent_test_cases for agent_name = "synthesis")
// keeps validating unchanged; see synthesis.ts's SYSTEM_PROMPT_BASE for when the model is
// asked to populate it, and buildAlertInput for the fallback when it's absent.
export const AlertDetailSchema = z.object({
  pattern: z.string().trim().min(1).max(ALERT_PATTERN_MAX_LENGTH),
  interpretation: z.string().trim().min(1).max(ALERT_INTERPRETATION_MAX_LENGTH),
  evidence: z.array(AlertEvidenceItemSchema).max(ALERT_EVIDENCE_MAX_ITEMS),
  recommended_actions: z
    .array(AlertRecommendedActionSchema)
    .max(ALERT_RECOMMENDED_ACTIONS_MAX_ITEMS),
});

// ── Comparative synthesis output ─────────────────────────────────────────
// Own-company monitoring: the 7th analysis node compares "us" against the workspace's real
// competitors and produces advisory "competitor did X, we haven't — possible reasons, possible
// responses" output. Fresh schema by design — the existing AnalysisDecisionSchema above
// describes single-competitor findings, not head-to-head comparisons. Field bounds mirror the
// alert-detail reasoning: this lands in a Postgres jsonb column AND is surfaced for a human to
// read, so lists are bounded and prose is length-capped.
const COMPARATIVE_HEADLINE_MAX_LENGTH = 200;
const COMPARATIVE_OBSERVATIONS_MAX_ITEMS = 10;
const COMPARATIVE_OBSERVATION_TEXT_MAX_LENGTH = 1_000;
const COMPARATIVE_GAPS_MAX_ITEMS = 10;
const COMPARATIVE_GAP_TEXT_MAX_LENGTH = 1_000;
const COMPARATIVE_REASON_RESPONSE_MAX_ITEMS = 5;
const COMPARATIVE_REASON_RESPONSE_MAX_LENGTH = 500;
const COMPARATIVE_SUMMARY_MAX_LENGTH = 2_000;

export const ComparativeObservationSchema = z.object({
  competitor_name: z.string().trim().min(1).max(200),
  what_they_did: z.string().trim().min(1).max(COMPARATIVE_OBSERVATION_TEXT_MAX_LENGTH),
});

export const ComparativeGapSchema = z.object({
  gap: z.string().trim().min(1).max(COMPARATIVE_GAP_TEXT_MAX_LENGTH),
  possible_reasons: z
    .array(z.string().trim().min(1).max(COMPARATIVE_REASON_RESPONSE_MAX_LENGTH))
    .max(COMPARATIVE_REASON_RESPONSE_MAX_ITEMS),
  possible_responses: z
    .array(z.string().trim().min(1).max(COMPARATIVE_REASON_RESPONSE_MAX_LENGTH))
    .max(COMPARATIVE_REASON_RESPONSE_MAX_ITEMS),
});

export const ComparativeSynthesisSchema = z.object({
  headline: z.string().trim().min(1).max(COMPARATIVE_HEADLINE_MAX_LENGTH),
  summary: z.string().trim().min(1).max(COMPARATIVE_SUMMARY_MAX_LENGTH),
  observations: z.array(ComparativeObservationSchema).max(COMPARATIVE_OBSERVATIONS_MAX_ITEMS),
  gaps: z.array(ComparativeGapSchema).max(COMPARATIVE_GAPS_MAX_ITEMS),
});

export const AnalysisDecisionSchema = z.object({
  action: z.enum(["alert", "digest", "suppress"]),
  reason: z.string(),
  // .catch(undefined), not just .optional(): withStructuredOutput's Zod parse is atomic over
  // the whole object — before this, `.optional()` alone meant a `detail` that's *present but
  // malformed* (a 6th evidence item, a stray whitespace-only string past .min(1), a wrong
  // `type` enum value — anything an LLM can plausibly emit under free-text generation, since
  // Anthropic's tool-calling only shapes the JSON structurally, it doesn't enforce
  // minLength/maxLength/enum server-side) failed the ENTIRE decision parse, not just `detail`.
  // That throws in synthesisNode before createSignalScore runs, losing that day's Signal Score
  // too, and a BullMQ retry re-invokes all 5 upstream branch nodes' LLM calls for a failure
  // that originates purely in optional alert-copy formatting. `.catch(undefined)` makes a
  // malformed `detail` degrade to the same "absent" case buildAlertInput already falls back
  // from — action/reason (the two fields an LLM essentially can't get wrong under forced
  // tool-calling) still parse and the run still succeeds.
  detail: AlertDetailSchema.optional().catch(undefined),
});

// ── forecaster ───────────────────────────────────────────────────────────
// The forecaster node's structured output: zero to three dated, resolvable
// predictions, or an explicit refusal to make any.
//
// Every bound here is load-bearing, because this schema is the only thing
// standing between a language model's natural fluency and a ledger full of
// claims nothing can settle:
//
//   probability  clamped away from 0 and 1 — a model that emits either is
//                claiming certainty, and a ledger that accepts it produces an
//                uninformative Brier score
//   statement    long enough to name a specific move; "big pricing move" is
//                not something a resolver can ever settle
//   horizon      bounded below so a prediction cannot resolve before evidence
//                could plausibly appear, and above so the ledger cannot be
//                padded with claims that come due after anyone cares
//   criteria     the shared discriminated union, so an unresolvable forecast
//                fails to parse rather than becoming a permanently open row
//
// An empty `forecasts` array is a valid, expected answer. The node is supposed
// to abstain more often than it speaks — `abstained_reason` is where it says
// why, so silence is legible instead of looking like a failure.
export const FORECAST_MAX_ITEMS = 3;

export const ForecastSchema = z.object({
  statement: z
    .string()
    .trim()
    .min(PREDICTION_STATEMENT_MIN_LENGTH)
    .max(PREDICTION_STATEMENT_MAX_LENGTH),
  pattern_type: PredictionPatternTypeSchema,
  probability: z.number().min(PREDICTION_PROBABILITY_MIN).max(PREDICTION_PROBABILITY_MAX),
  horizon_days: z
    .number()
    .int()
    .min(PREDICTION_HORIZON_MIN_DAYS)
    .max(PREDICTION_HORIZON_MAX_DAYS),
  resolution_criteria: ResolutionCriteriaSchema,
  reasoning: z.string().trim().min(1).max(2_000),
});
export type Forecast = z.infer<typeof ForecastSchema>;

export const ForecastOutputSchema = z.object({
  forecasts: z.array(ForecastSchema).max(FORECAST_MAX_ITEMS),
  abstained_reason: z.string().trim().max(500).nullable(),
});
export type ForecastOutput = z.infer<typeof ForecastOutputSchema>;
