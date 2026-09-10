// LangGraph node — pricing-change extraction (GPT-4o-mini). Runs unconditionally in the DAG,
// but short-circuits to a no-op (no DB call, no LLM call) unless state.has_pricing_diff is set.
import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AnalysisGraphState, PricingChangeResult } from "../../graph/state";
import { logger } from "../../lib/logger";
import { getCompanyContext } from "../../lib/company-context";
import { getRecentPricingDiffs, type PricingDiff, type PricingSignificance } from "../../db/queries";
import { trackLatency } from "../../lib/latency-tracker";
import { trackCost } from "../../llm/cost-tracker";

const AGENT_NAME = "change_detector" as const;
const MODEL = "gpt-4o-mini";

// Bounded client budget — same reasoning as intent-analyzer.ts/entity-extractor.ts:
// LangChain's defaults can hold a call open far longer than this pipeline can tolerate
// on a hung endpoint.
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;

// Same "don't blow the context window" reasoning as intent-analyzer.ts's
// INTENT_ANALYZER_INPUT_MAX_LENGTH — a pricing page diff is normally small, but nothing
// upstream bounds how many lines a single scrape can produce.
export const CHANGE_DETECTOR_INPUT_MAX_LENGTH = 24_000;

// Rank used to pick which diff to extract from when getRecentPricingDiffs returns more
// than one — lower rank wins. Resolved rule (pre-decided, not re-derived here): critical
// > moderate > minor.
const SEVERITY_RANK: Record<PricingSignificance, number> = {
  critical: 0,
  moderate: 1,
  minor: 2,
};

// getRecentPricingDiffs already orders detected_at desc. Array.prototype.sort is
// spec-guaranteed stable (ES2019+), so sorting only on severity rank here preserves that
// existing recency order as the tie-break among same-severity diffs, without a second
// explicit key.
function selectDiffToExtract(diffs: PricingDiff[]): PricingDiff {
  return [...diffs].sort(
    (a, b) =>
      SEVERITY_RANK[a.significance as PricingSignificance] -
      SEVERITY_RANK[b.significance as PricingSignificance]
  )[0];
}

// `diff` is jsonb typed `Record<string, unknown>` in the schema — it's written exclusively
// by collectors/pricing.ts's `{ added: string[]; removed: string[] }` shape, but that's not
// enforced at the DB layer, so narrow rather than casting blind.
function narrowDiffPayload(diff: Record<string, unknown>): { added: string[]; removed: string[] } {
  const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((line) => typeof line === "string");
  return {
    added: isStringArray(diff.added) ? diff.added : [],
    removed: isStringArray(diff.removed) ? diff.removed : [],
  };
}

const PricingChangeSchema = z.object({
  summary: z.string(),
  old_price: z.string().nullable(),
  new_price: z.string().nullable(),
});

const SYSTEM_PROMPT_BASE =
  "Analyze the following pricing page diff for a competitor — lines added and removed " +
  "since the last scrape. Extract the old_price and new_price if the diff clearly shows a " +
  "price changing (e.g. a tier's price line was replaced by a new one). Use null for " +
  "old_price and/or new_price if the diff doesn't clearly state a comparable price " +
  "(e.g. a tier was only added or only removed with nothing to compare it to). Write a " +
  "brief summary of what changed.";

function buildDiffText(diff: { added: string[]; removed: string[] }): string {
  const sections = [];
  if (diff.removed.length) sections.push(`Removed:\n${diff.removed.join("\n")}`);
  if (diff.added.length) sections.push(`Added:\n${diff.added.join("\n")}`);
  return sections.join("\n\n").slice(0, CHANGE_DETECTOR_INPUT_MAX_LENGTH);
}

export async function changeDetectorNode(
  state: typeof AnalysisGraphState.State
): Promise<Partial<typeof AnalysisGraphState.State>> {
  // This node runs unconditionally in the DAG (so synthesis's 5-way fan-in is always
  // satisfiable — see analysis-graph.ts). The "only do work when a pricing diff landed"
  // decision lives here instead of in a graph edge: `has_pricing_diff` is the caller's
  // cheap upstream signal, so a `false` means there is nothing to extract — return without
  // even a DB round-trip.
  if (!state.has_pricing_diff) {
    return {};
  }

  const diffs = await getRecentPricingDiffs(state.competitor_id, 7);

  // has_pricing_diff was set but the diff isn't in the 7-day window any more — it aged out
  // between the caller's check and this node running. Nothing to extract.
  if (diffs.length === 0) {
    logger.warn(
      "change-detector: has_pricing_diff was set but no recent pricing diffs found — diff may have aged out of the 7-day window",
      { competitor_id: state.competitor_id, run_id: state.run_id }
    );
    return {};
  }

  const selectedDiff = selectDiffToExtract(diffs);
  const diffPayload = narrowDiffPayload(selectedDiff.diff);

  const companyContext = await getCompanyContext();
  const systemPrompt = companyContext
    ? `${SYSTEM_PROMPT_BASE}\n\n${companyContext}`
    : SYSTEM_PROMPT_BASE;

  const chatModel = new ChatOpenAI({
    model: MODEL,
    timeout: LLM_TIMEOUT_MS,
    maxRetries: LLM_MAX_RETRIES,
  });
  const structuredModel = chatModel.withStructuredOutput(PricingChangeSchema, {
    includeRaw: true,
  });

  const { raw, parsed } = await trackLatency(AGENT_NAME, state.competitor_id, state.run_id, () =>
    structuredModel.invoke([
      ["system", systemPrompt],
      ["human", buildDiffText(diffPayload)],
    ])
  );

  // The call was made and billed whether or not the response parsed — track it first.
  const usage = (raw as AIMessage).usage_metadata;
  await trackCost(
    AGENT_NAME,
    MODEL,
    usage?.input_tokens ?? 0,
    usage?.output_tokens ?? 0,
    state.run_id,
    state.competitor_id
  );

  // withStructuredOutput({ includeRaw: true }) does NOT throw on a Zod validation
  // failure — it hands back parsed: null while the TS type still claims
  // PricingChangeResult. Returning that straight through would silently write a null
  // pricing_change and report success.
  if (!parsed) {
    logger.error("change-detector: structured output failed schema validation", {
      competitor_id: state.competitor_id,
      run_id: state.run_id,
      raw_content: (raw as AIMessage)?.content,
    });
    throw new Error(
      `change-detector: structured output failed schema validation for competitor ${state.competitor_id}`
    );
  }

  const pricing_change: PricingChangeResult = parsed;
  return { pricing_change };
}
