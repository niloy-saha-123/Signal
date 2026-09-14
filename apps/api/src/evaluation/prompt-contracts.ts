import { z } from "zod";
import { AgentNameSchema, type AgentName } from "@signal/shared";
import type { agentTestCasesTable, promptVersionsTable } from "../db/schema";
import {
  AnalysisDecisionSchema,
  HiringIntentSchema,
  PatternsSchema,
  PricingChangeSchema,
  SentimentClustersSchema,
  VulnerabilityPositioningSchema,
  VulnerabilityResultSchema,
  VulnerabilityWindowSchema,
} from "../agents/analysis/contracts";

const NonEmptyTextSchema = z.string().trim().min(1);
const NonBlankPreservedTextSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected non-blank text");

// Re-export the exact schemas used by the production model boundaries. The
// evaluator layers only the documented non-empty prose checks below; it does
// not duplicate the label enums or structured field types.
export const HiringIntentResultSchema = HiringIntentSchema;
export const SentimentClustersResultSchema = SentimentClustersSchema;
export const PricingChangeResultSchema = PricingChangeSchema;
export const PatternsResultSchema = PatternsSchema;
export {
  VulnerabilityPositioningSchema,
  VulnerabilityResultSchema,
  VulnerabilityWindowSchema,
};
export const SynthesisDecisionSchema = AnalysisDecisionSchema;

export const SupportedPromptEvaluationAgentSchema = z.enum([
  "intent_analyzer",
  "sentiment_clusterer",
  "change_detector",
  "pattern_detector",
  "vulnerability_detector",
  "synthesis",
]);

export type SupportedPromptEvaluationAgent = z.infer<
  typeof SupportedPromptEvaluationAgentSchema
>;

const outputSchemas = {
  intent_analyzer: HiringIntentResultSchema,
  sentiment_clusterer: SentimentClustersResultSchema,
  change_detector: PricingChangeResultSchema,
  pattern_detector: PatternsResultSchema,
  vulnerability_detector: VulnerabilityResultSchema,
  synthesis: SynthesisDecisionSchema,
} as const;

const structuralTextSchemas = {
  intent_analyzer: z.object({ summary: NonEmptyTextSchema }),
  sentiment_clusterer: z.object({ summary: NonEmptyTextSchema }),
  change_detector: z.object({ summary: NonEmptyTextSchema }),
  pattern_detector: z.object({ summary: NonEmptyTextSchema }),
  vulnerability_detector: z.object({ summary: NonEmptyTextSchema }),
  synthesis: z.object({ reason: NonEmptyTextSchema }),
} as const;

export function assertSupportedPromptEvaluationAgent(
  agentName: AgentName
): asserts agentName is SupportedPromptEvaluationAgent {
  if (!SupportedPromptEvaluationAgentSchema.safeParse(agentName).success) {
    throw new Error(`Unsupported prompt evaluator: ${agentName}`);
  }
}

export function parsePromptEvaluationOutput(
  agentName: AgentName,
  output: unknown
): unknown {
  assertSupportedPromptEvaluationAgent(agentName);
  const parsed = outputSchemas[agentName].parse(output);
  structuralTextSchemas[agentName].parse(parsed);
  return parsed;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function normalizedSet(values: string[]): string[] {
  return [...new Set(values.map(normalizeText))].sort();
}

function equalStringSets(left: string[], right: string[]): boolean {
  const normalizedLeft = normalizedSet(left);
  const normalizedRight = normalizedSet(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function normalizeNullableText(value: string | null): string | null {
  return value === null ? null : normalizeText(value);
}

// Free-text fields are structurally validated above. They are deliberately not
// scored as semantic similarity: only each agent's faithful, finite label
// contract participates in the deterministic regression score.
export function comparePromptResults(
  agentName: AgentName,
  actualValue: unknown,
  expectedValue: unknown
): boolean {
  assertSupportedPromptEvaluationAgent(agentName);

  switch (agentName) {
    case "intent_analyzer": {
      const actual = HiringIntentResultSchema.parse(actualValue);
      const expected = HiringIntentResultSchema.parse(expectedValue);
      return actual.intent_level === expected.intent_level;
    }
    case "sentiment_clusterer": {
      const actual = SentimentClustersResultSchema.parse(actualValue);
      const expected = SentimentClustersResultSchema.parse(expectedValue);
      return (
        equalStringSets(actual.new_complaints, expected.new_complaints) &&
        equalStringSets(actual.chronic_complaints, expected.chronic_complaints)
      );
    }
    case "change_detector": {
      const actual = PricingChangeResultSchema.parse(actualValue);
      const expected = PricingChangeResultSchema.parse(expectedValue);
      return (
        normalizeNullableText(actual.old_price) ===
          normalizeNullableText(expected.old_price) &&
        normalizeNullableText(actual.new_price) === normalizeNullableText(expected.new_price)
      );
    }
    case "pattern_detector": {
      const actual = PatternsResultSchema.parse(actualValue);
      const expected = PatternsResultSchema.parse(expectedValue);
      return actual.trend === expected.trend;
    }
    case "vulnerability_detector": {
      const actual = VulnerabilityResultSchema.parse(actualValue);
      const expected = VulnerabilityResultSchema.parse(expectedValue);
      return actual.window_open === expected.window_open;
    }
    case "synthesis": {
      const actual = SynthesisDecisionSchema.parse(actualValue);
      const expected = SynthesisDecisionSchema.parse(expectedValue);
      return actual.action === expected.action;
    }
  }
}

export const PromptEvaluationRequestSchema = z
  .object({
    agentName: AgentNameSchema,
    version: z.number().int().safe().positive(),
  })
  .strict();

export const PromptVersionCandidateSchema = z
  .object({
    id: z.string().uuid(),
    agent_name: AgentNameSchema,
    version: z.number().int().safe().positive(),
    prompt_text: NonBlankPreservedTextSchema,
    is_active: z.boolean(),
    accuracy: z.number().finite().min(0).max(1).nullable(),
    promoted_at: z.date().nullable(),
    created_at: z.date(),
  })
  .strict();

export const AgentTestCaseSchema = z
  .object({
    id: z.string().uuid(),
    agent_name: AgentNameSchema,
    input: z.record(z.unknown()),
    expected_output: z.record(z.unknown()),
    created_at: z.date(),
  })
  .strict();

export type PromptEvaluationRequest = z.infer<typeof PromptEvaluationRequestSchema>;
type PromptVersionRow = typeof promptVersionsTable.$inferSelect;
type AgentTestCaseRow = typeof agentTestCasesTable.$inferSelect;
export type PromptVersionCandidate = Omit<PromptVersionRow, "agent_name"> & {
  agent_name: AgentName;
};
export type AgentTestCase = Omit<AgentTestCaseRow, "agent_name"> & {
  agent_name: AgentName;
};

export const EvaluationCountsSchema = z
  .object({
    passed: z.number().int().safe().min(0),
    total: z.number().int().safe().min(1),
  })
  .strict()
  .refine((value) => value.passed <= value.total, {
    message: "Passed count cannot exceed total count",
    path: ["passed"],
  });

export type EvaluationCounts = z.infer<typeof EvaluationCountsSchema>;

export const PromotePromptVersionInputSchema = z
  .object({
    agentName: AgentNameSchema,
    candidateVersion: z.number().int().safe().positive(),
    activeVersion: z.number().int().safe().positive(),
    candidate: EvaluationCountsSchema,
    active: EvaluationCountsSchema,
  })
  .strict();

export type PromotePromptVersionInput = z.infer<typeof PromotePromptVersionInputSchema>;

export type TwoProportionResult = {
  candidate_accuracy: number;
  active_accuracy: number;
  pooled_proportion: number;
  standard_error: number;
  z_score: number;
  p_value: number;
};

export type PromotionResult = {
  agent_name: AgentName;
  candidate_version: number;
  active_version: number;
  promoted: boolean;
  reason: "promoted" | "not-better" | "not-significant";
  candidate_counts: EvaluationCounts;
  active_counts: EvaluationCounts;
  statistics: TwoProportionResult;
};


// Abramowitz and Stegun 7.1.26. This deterministic erf approximation has a
// maximum absolute error around 1.5e-7, which is sufficient for a fixed 0.05
// operational gate without sampling or a statistics-provider dependency.
function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t);
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

export function twoProportionZTest(
  candidatePass: number,
  candidateTotal: number,
  activePass: number,
  activeTotal: number
): TwoProportionResult {
  const candidate = EvaluationCountsSchema.parse({
    passed: candidatePass,
    total: candidateTotal,
  });
  const active = EvaluationCountsSchema.parse({ passed: activePass, total: activeTotal });
  const candidateAccuracy = candidate.passed / candidate.total;
  const activeAccuracy = active.passed / active.total;
  const pooledProportion =
    (candidate.passed + active.passed) / (candidate.total + active.total);
  const standardError = Math.sqrt(
    pooledProportion *
      (1 - pooledProportion) *
      (1 / candidate.total + 1 / active.total)
  );

  if (standardError === 0) {
    if (candidateAccuracy !== activeAccuracy) {
      throw new Error("Unequal proportions cannot have zero standard error");
    }
    return {
      candidate_accuracy: candidateAccuracy,
      active_accuracy: activeAccuracy,
      pooled_proportion: pooledProportion,
      standard_error: 0,
      z_score: 0,
      p_value: 1,
    };
  }

  const zScore = (candidateAccuracy - activeAccuracy) / standardError;
  const rawPValue = 2 * (1 - normalCdf(Math.abs(zScore)));
  return {
    candidate_accuracy: candidateAccuracy,
    active_accuracy: activeAccuracy,
    pooled_proportion: pooledProportion,
    standard_error: standardError,
    z_score: zScore,
    // Clamp floating-point dust only; invalid inputs were rejected above.
    p_value: Math.max(0, Math.min(1, rawPValue)),
  };
}

export function passesPromotionGate(statistics: TwoProportionResult): boolean {
  return (
    statistics.candidate_accuracy > statistics.active_accuracy &&
    statistics.p_value < 0.05
  );
}
