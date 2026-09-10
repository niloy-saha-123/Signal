// LangGraph node — the fan-in. Runs exactly once after all 5 branch nodes complete. It both
// (a) computes + persists the competitor's daily Signal Score (0-100) and (b) makes the
// alert/digest/suppress decision via one Claude Sonnet call.
//
// The 4 numeric Signal Score components are pure deterministic math (no LLM) — same precedent
// as pipeline/quality-scorer.ts (Part 7): no real engagement data exists, so a documented
// proxy is used rather than inventing fake precision. Only the final alert/digest/suppress
// call goes to a model. Latency of the LLM call is tracked via latency-tracker.ts; the score
// components are stored as JSONB in competitor_signal_scores alongside the composite score.
import { ChatAnthropic } from "@langchain/anthropic";
import type { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SignalScore } from "@signal/shared";
import type {
  AnalysisDecision,
  AnalysisGraphState,
  AnalysisGraphStateType,
  HiringIntentResult,
  SentimentClustersResult,
  VulnerabilityResult,
} from "../../graph/state";
import { logger } from "../../lib/logger";
import { getCompanyContext } from "../../lib/company-context";
import {
  getSignalVolumeByDay,
  getRecentPricingDiffs,
  getLatestSignalScores,
  createSignalScore,
  completeAgentRun,
  type SignalVolumeByDay,
  type SignalScore as SignalScoreRow,
} from "../../db/queries";
import { trackLatency } from "../../lib/latency-tracker";
import { trackCost } from "../../llm/cost-tracker";
import { selectModel } from "../../llm/adaptive-router";
import { ANTHROPIC_MODEL_IDS } from "./sentiment-clusterer";

const AGENT_NAME = "synthesis" as const;
// "claude-sonnet" IS a DOWNGRADE_MAP key — selectModel can hand back either "claude-sonnet"
// or the downgraded "claude-haiku" here depending on today's spend. Whichever comes back is
// translated through ANTHROPIC_MODEL_IDS for the constructor, and passed untranslated to
// trackCost (same as vulnerability-detector.ts's second call).
const PREFERRED_MODEL = "claude-sonnet";

// Bounded client budget — same reasoning as every other LLM-calling agent in this codebase:
// LangChain's defaults can hold a call open far longer than this pipeline can tolerate on a
// hung endpoint.
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;

// Same "don't blow the context window" bound as the other analysis agents' *_INPUT_MAX_LENGTH.
export const SYNTHESIS_INPUT_MAX_LENGTH = 24_000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// pricing_change_recency decay: a pricing move stays relevant far longer than a single
// signal's freshness (quality-scorer.ts uses a 7-day half-life for those), so this doubles it.
const PRICING_RECENCY_HALF_LIFE_DAYS = 14;

// Composite score weighting. The 4 numeric components are each "higher = more threatening";
// mention_velocity and sentiment_trajectory land in [-1, 1], hiring_momentum and
// pricing_change_recency in [0, 1]. Weights total 1, so the weighted sum stays in [-1, 1]
// and maps linearly onto [0, 100] as 50 + 50 * sum (0 -> midpoint 50). The vulnerability
// window is then a flat modifier, not a weighted term — its signal is categorical, not scalar.
const COMPONENT_WEIGHTS = {
  mention_velocity: 0.3, // volume spikes are the loudest near-term threat signal
  sentiment_trajectory: 0.25, // shifting community sentiment compounds over time
  hiring_momentum: 0.25, // aggressive hiring implies roadmap acceleration
  pricing_change_recency: 0.2, // a recent pricing move is a discrete competitive event
} as const;

// open  -> competitor is exposed and we can act now: more urgent to surface (+12)
// closed -> a window existed and has shut: neutral (0)
// none  -> no window ever identified: marginally less threatening (-6)
const VULNERABILITY_MODIFIER: Record<"open" | "closed" | "none", number> = {
  open: 12,
  closed: 0,
  none: -6,
};

// Delta baseline selection: prior-score rows never land exactly 7 or 30 days back (a daily
// recompute can slip, backfill, or miss a day), so we take the row whose age is closest to
// the target within a tolerance — tighter for the 7-day window, looser for the 30-day one.
// No row in tolerance -> null (a brand-new competitor with no prior rows also lands here);
// null means "no baseline yet", which is not the same claim as 0 ("no change").
const DELTA_7D_TARGET_DAYS = 7;
const DELTA_7D_TOLERANCE_DAYS = 2;
const DELTA_30D_TARGET_DAYS = 30;
const DELTA_30D_TOLERANCE_DAYS = 5;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const INTENT_LEVEL_TO_MOMENTUM: Record<"low" | "medium" | "high", number> = {
  low: 0,
  medium: 0.5,
  high: 1,
};

const DecisionSchema = z.object({
  action: z.enum(["alert", "digest", "suppress"]),
  reason: z.string(),
});

const SYSTEM_PROMPT_BASE =
  "You decide how to surface a competitor's daily competitive-intelligence update to a " +
  "product and growth team. Given the competitor's computed Signal Score (0-100 composite " +
  "threat score), its five components, each analysis agent's summary, and the 7-day and " +
  "30-day score deltas, choose exactly one action: \"alert\" (urgent — notify the team " +
  "immediately), \"digest\" (include in the routine daily briefing), or \"suppress\" (not " +
  "worth the team's attention today). Explain your choice in one or two sentences.";

// recent-7-days signal count vs. prior-7-days count, as a ratio-based delta clamped to
// [-1, 1] so a divide-by-near-zero spike can't produce a non-finite value.
function computeMentionVelocity(volumeByDay: SignalVolumeByDay[], now: number): number {
  let recent7 = 0;
  let prior7 = 0;
  for (const row of volumeByDay) {
    const ageDays = (now - new Date(row.day).getTime()) / MS_PER_DAY;
    if (ageDays < 7) recent7 += row.count;
    else if (ageDays < 14) prior7 += row.count;
  }
  return clamp((recent7 - prior7) / Math.max(prior7, 1), -1, 1);
}

// (chronic - new) * -1, normalized by the total complaint count, clamped to [-1, 1].
// Null clusters (sentiment branch produced nothing) -> 0 (neutral).
function computeSentimentTrajectory(clusters: SentimentClustersResult | null): number {
  if (!clusters) return 0;
  const chronic = clusters.chronic_complaints.length;
  const fresh = clusters.new_complaints.length;
  const total = Math.max(chronic + fresh, 1);
  return clamp(((chronic - fresh) * -1) / total, -1, 1);
}

function computeHiringMomentum(hiringIntent: HiringIntentResult | null): number {
  if (!hiringIntent) return 0;
  return INTENT_LEVEL_TO_MOMENTUM[hiringIntent.intent_level];
}

// Exponential recency decay off the most recent pricing diff's detected_at:
// exp(-ageDays * ln(2) / HALF_LIFE). 0 if no diff exists in the 30-day lookback window.
function computePricingChangeRecency(
  diffs: Awaited<ReturnType<typeof getRecentPricingDiffs>>,
  now: number
): number {
  const mostRecent = diffs[0];
  if (!mostRecent) return 0;
  const ageDays = Math.max((now - new Date(mostRecent.detected_at).getTime()) / MS_PER_DAY, 0);
  return clamp(Math.exp((-ageDays * Math.LN2) / PRICING_RECENCY_HALF_LIFE_DAYS), 0, 1);
}

function computeVulnerabilityWindowStatus(
  vulnerability: VulnerabilityResult | null
): "open" | "closed" | "none" {
  if (vulnerability === null) return "none";
  return vulnerability.window_open ? "open" : "closed";
}

function computeCompositeScore(components: {
  mention_velocity: number;
  sentiment_trajectory: number;
  hiring_momentum: number;
  pricing_change_recency: number;
  vulnerability_window_status: "open" | "closed" | "none";
}): number {
  const weightedSum =
    components.mention_velocity * COMPONENT_WEIGHTS.mention_velocity +
    components.sentiment_trajectory * COMPONENT_WEIGHTS.sentiment_trajectory +
    components.hiring_momentum * COMPONENT_WEIGHTS.hiring_momentum +
    components.pricing_change_recency * COMPONENT_WEIGHTS.pricing_change_recency;
  const raw =
    50 + 50 * weightedSum + VULNERABILITY_MODIFIER[components.vulnerability_window_status];
  // Clamp in code — never rely on the DB CHECK (0..100) to catch a bug (Part 7's lesson).
  return clamp(Math.round(raw), 0, 100);
}

function pickBaselineScore(
  rows: SignalScoreRow[],
  targetDays: number,
  toleranceDays: number,
  now: number
): SignalScoreRow | null {
  let best: SignalScoreRow | null = null;
  let bestGap = Infinity;
  for (const row of rows) {
    const ageDays = (now - new Date(row.computed_at).getTime()) / MS_PER_DAY;
    const gap = Math.abs(ageDays - targetDays);
    if (gap <= toleranceDays && gap < bestGap) {
      best = row;
      bestGap = gap;
    }
  }
  return best;
}

function summaryOrNA(value: { summary: string } | null): string {
  return value?.summary ?? "N/A";
}

function buildContextText(input: {
  score: number;
  components: {
    mention_velocity: number;
    sentiment_trajectory: number;
    hiring_momentum: number;
    pricing_change_recency: number;
    vulnerability_window_status: "open" | "closed" | "none";
  };
  state: AnalysisGraphStateType;
  delta7d: number | null;
  delta30d: number | null;
}): string {
  const { score, components, state, delta7d, delta30d } = input;
  const text = [
    `Signal Score: ${score}/100`,
    "",
    "Components:",
    `- mention_velocity: ${components.mention_velocity}`,
    `- sentiment_trajectory: ${components.sentiment_trajectory}`,
    `- hiring_momentum: ${components.hiring_momentum}`,
    `- pricing_change_recency: ${components.pricing_change_recency}`,
    `- vulnerability_window_status: ${components.vulnerability_window_status}`,
    "",
    "Agent summaries:",
    `- Hiring intent: ${summaryOrNA(state.hiring_intent)}`,
    `- Sentiment: ${summaryOrNA(state.sentiment_clusters)}`,
    `- Pricing change: ${summaryOrNA(state.pricing_change)}`,
    `- Patterns: ${summaryOrNA(state.patterns)}`,
    `- Vulnerability: ${summaryOrNA(state.vulnerability)}`,
    "",
    `7-day score delta: ${delta7d === null ? "no baseline yet" : delta7d}`,
    `30-day score delta: ${delta30d === null ? "no baseline yet" : delta30d}`,
  ].join("\n");
  return text.slice(0, SYNTHESIS_INPUT_MAX_LENGTH);
}

export async function synthesisNode(
  state: typeof AnalysisGraphState.State
): Promise<Partial<typeof AnalysisGraphState.State>> {
  const now = Date.now();

  // 1-2. Deterministic components. Each prior state field is typed `X | null` — LangGraph's
  // fan-in normally populates them, but the type allows null (e.g. pricing_change is only set
  // when the pricing branch ran), so every component handles null itself.
  const [volumeByDay, pricingDiffs] = await Promise.all([
    getSignalVolumeByDay(state.competitor_id, 14),
    getRecentPricingDiffs(state.competitor_id, 30),
  ]);

  const components = {
    mention_velocity: computeMentionVelocity(volumeByDay, now),
    sentiment_trajectory: computeSentimentTrajectory(state.sentiment_clusters),
    hiring_momentum: computeHiringMomentum(state.hiring_intent),
    pricing_change_recency: computePricingChangeRecency(pricingDiffs, now),
    vulnerability_window_status: computeVulnerabilityWindowStatus(state.vulnerability),
  };

  // 3. Composite score.
  const score = computeCompositeScore(components);

  // 4. Deltas against prior scores.
  const priorScores = await getLatestSignalScores(state.competitor_id, 40);
  const baseline7d = pickBaselineScore(
    priorScores,
    DELTA_7D_TARGET_DAYS,
    DELTA_7D_TOLERANCE_DAYS,
    now
  );
  const baseline30d = pickBaselineScore(
    priorScores,
    DELTA_30D_TARGET_DAYS,
    DELTA_30D_TOLERANCE_DAYS,
    now
  );
  const delta7d = baseline7d ? score - baseline7d.score : null;
  const delta30d = baseline30d ? score - baseline30d.score : null;

  // 5. Persist.
  const created = await createSignalScore({
    competitor_id: state.competitor_id,
    score,
    components,
    delta_7d: delta7d,
    delta_30d: delta30d,
  });

  // 6. Decision LLM call.
  const companyContext = await getCompanyContext();
  const systemPrompt = companyContext
    ? `${SYSTEM_PROMPT_BASE}\n\n${companyContext}`
    : SYSTEM_PROMPT_BASE;

  const modelAlias = await selectModel(PREFERRED_MODEL, true);
  const chatModel = new ChatAnthropic({
    model: ANTHROPIC_MODEL_IDS[modelAlias] ?? modelAlias,
    // ChatAnthropic has no top-level `timeout` — the underlying SDK client takes it via
    // clientOptions instead (the form Task 3 established).
    clientOptions: { timeout: LLM_TIMEOUT_MS },
    maxRetries: LLM_MAX_RETRIES,
  });
  const structuredModel = chatModel.withStructuredOutput(DecisionSchema, { includeRaw: true });

  const contextText = buildContextText({ score, components, state, delta7d, delta30d });

  const { raw, parsed } = await trackLatency(AGENT_NAME, state.competitor_id, state.run_id, () =>
    structuredModel.invoke([
      ["system", systemPrompt],
      ["human", contextText],
    ])
  );

  // The call was made and billed whether or not the response parsed — track it first.
  const usage = (raw as AIMessage).usage_metadata;
  await trackCost(
    AGENT_NAME,
    modelAlias,
    usage?.input_tokens ?? 0,
    usage?.output_tokens ?? 0,
    state.run_id,
    state.competitor_id
  );

  // withStructuredOutput({ includeRaw: true }) hands back parsed: null on a Zod validation
  // failure rather than throwing — returning that straight through would write a null
  // decision and report success.
  if (!parsed) {
    logger.error("synthesis: decision structured output failed schema validation", {
      competitor_id: state.competitor_id,
      run_id: state.run_id,
      raw_content: (raw as AIMessage)?.content,
    });
    throw new Error(
      `synthesis: decision structured output failed schema validation for competitor ${state.competitor_id}`
    );
  }

  const decision: AnalysisDecision = parsed;

  // 7. Close out the run. NOT wrapped in a try/catch that marks it "failed" on error — the
  // agent_runs row's lifecycle belongs to this node's (not-yet-built) caller, the analysis
  // queue worker, not to the node. A throw above propagates to that caller unhandled by design.
  await completeAgentRun(state.run_id, "completed", decision.action);

  // 8. `created` is the drizzle row — its computed_at is a Date and components is
  // Record<string, unknown>, whereas @signal/shared's SignalScore Zod type models them as an
  // ISO string / the typed components object. The row is written correctly; only the static
  // shape differs at this boundary.
  return { signal_score: created as unknown as SignalScore, decision };
}
