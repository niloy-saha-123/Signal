// LangGraph node — turns the run's accumulated evidence into dated, falsifiable
// predictions (Claude Sonnet).
//
// This is the node the rest of the product is built around, and the thing it does
// most often is decline to speak. Every other competitive-intelligence tool on the
// market emits confident forward-looking claims and never revisits them, which is
// why "too much noise" is the single complaint their users share. A prediction
// that must later be resolved against real evidence is expensive to make, so the
// cheapest way to keep the ledger honest is to make the node reluctant:
//
//   1. EVIDENCE_FLOOR gates the model entirely. Below it, no call is made. A model
//      handed four signals will still produce three fluent forecasts — that is what
//      language models do — so the only reliable defence is not to ask.
//   2. The floor counts distinct clusters, not signal rows. Ten copies of one story
//      is one piece of evidence, and counting rows would let a single noisy Reddit
//      thread clear the bar on its own.
//   3. ForecastOutputSchema caps output at three and permits an empty list with a
//      stated reason, so abstaining is a first-class answer rather than a failure.
//
// Failure posture matches the other branch nodes: a forecasting failure degrades to
// `{}` and the run still produces its Signal Score. Predictions are the valuable
// part of the product, not the load-bearing part of the pipeline.
import { ChatAnthropic } from "@langchain/anthropic";
import type { AIMessage } from "@langchain/core/messages";
import type { AnalysisGraphState } from "../../graph/state";
import { ForecastOutputSchema, type Forecast } from "./contracts";
import { logger } from "../../lib/logger";
import { getCompanyContext } from "../../lib/company-context";
import {
  getRecentSignalsByCompetitorIds,
  createPrediction,
  type Signal,
} from "../../db/queries";
import { trackLatency } from "../../lib/latency-tracker";
import { trackCost } from "../../llm/cost-tracker";
import { selectModel, ANTHROPIC_MODEL_IDS } from "../../llm/adaptive-router";
import { getActivePrompt } from "../../llm/prompt-registry";
import { withCircuitBreaker } from "../../reliability/circuit-breaker";
import { runBranchNode, isLlmBudgetExhausted } from "./branch-node";

const AGENT_NAME = "forecaster" as const;
const PREFERRED_MODEL = "claude-sonnet";

// Bounded client budget — same reasoning as every other LLM-calling node here.
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;

// Minimum distinct signal clusters before the node will forecast at all.
//
// Five is a judgement, not a derivation: it is the point at which corroboration
// across sources starts to mean something rather than one story being retold.
// ponytail: a single global floor — a competitor with six months of history could
// justifiably forecast on thinner current evidence than one added yesterday; make
// it a function of history length if the abstain rate proves too blunt.
export const EVIDENCE_FLOOR = 5;

// How far back the forecaster looks. Long enough to see a trend build, short enough
// that the evidence still describes what the competitor is doing now.
const EVIDENCE_WINDOW_DAYS = 30;

// Same "don't blow the context window" bound the other nodes apply.
const FORECASTER_INPUT_MAX_LENGTH = 24_000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SYSTEM_PROMPT_BASE = [
  "You are a forecaster. Given recent evidence about a competitor, produce zero to three",
  "specific, dated predictions about what they will do next.",
  "",
  "Rules you must follow:",
  "- A prediction must be specific enough that someone could later check it without",
  "  asking you what you meant. 'Acme makes a pricing move' is not a prediction.",
  "- State a calibrated probability. If you would not bet at those odds, they are wrong.",
  "  You cannot state certainty; probabilities are bounded to 0.05-0.95.",
  "- Every prediction needs machine-checkable resolution_criteria drawn from the",
  "  evidence sources available: signal_match, github_release, or pricing_change.",
  "- Returning an empty list is correct and expected when the evidence is routine.",
  "  Say why in abstained_reason. You are judged on accuracy over time, not volume,",
  "  and a wrong prediction costs more than a missing one.",
].join("\n");

// Distinct clusters, not rows. A signal that never clustered (cluster_id null) is
// its own distinct piece of evidence, keyed by its own id.
export function countDistinctEvidence(signals: Signal[]): number {
  return new Set(signals.map((signal) => signal.cluster_id ?? signal.id)).size;
}

function buildEvidenceText(signals: Signal[]): string {
  const text = signals
    .map((signal) => {
      const header = `[${signal.source}] ${signal.title ?? "(untitled)"}`;
      return `${header}\n${signal.raw_text}`;
    })
    .join("\n\n---\n\n");
  return text.slice(0, FORECASTER_INPUT_MAX_LENGTH);
}

export async function forecasterNode(
  state: typeof AnalysisGraphState.State
): Promise<Partial<typeof AnalysisGraphState.State>> {
  return runBranchNode(AGENT_NAME, state, async () => {
    const signals = await getRecentSignalsByCompetitorIds(
      [state.competitor_id],
      EVIDENCE_WINDOW_DAYS
    );

    const evidenceCount = countDistinctEvidence(signals);
    if (evidenceCount < EVIDENCE_FLOOR) {
      // Not a failure. This is the node working — the floor exists precisely so
      // that thin evidence produces silence instead of confident invention.
      logger.info("forecaster: evidence below the floor — abstaining without a model call", {
        competitor_id: state.competitor_id,
        run_id: state.run_id,
        evidence_count: evidenceCount,
        floor: EVIDENCE_FLOOR,
      });
      return { forecasts: [] };
    }

    if (await isLlmBudgetExhausted(AGENT_NAME, state)) return {};

    const modelAlias = await selectModel(PREFERRED_MODEL, true);
    const promptText = (await getActivePrompt(AGENT_NAME)) ?? SYSTEM_PROMPT_BASE;
    const companyContext = await getCompanyContext(state.workspace_id);
    const systemPrompt = companyContext ? `${promptText}\n\n${companyContext}` : promptText;

    const chatModel = new ChatAnthropic({
      model: ANTHROPIC_MODEL_IDS[modelAlias] ?? modelAlias,
      clientOptions: { timeout: LLM_TIMEOUT_MS },
      maxRetries: LLM_MAX_RETRIES,
    });
    const structuredModel = chatModel.withStructuredOutput(ForecastOutputSchema, {
      includeRaw: true,
    });

    const telemetryContext = {
      competitorId: state.competitor_id,
      identity: { kind: "run" as const, runId: state.run_id },
    };

    const { raw, parsed } = await trackLatency(AGENT_NAME, telemetryContext, () =>
      withCircuitBreaker(`analysis:${AGENT_NAME}`, () =>
        structuredModel.invoke([
          ["system", systemPrompt],
          ["human", buildEvidenceText(signals)],
        ])
      )
    );

    // The call was made and billed whether or not the response parsed.
    const usage = (raw as AIMessage)?.usage_metadata;
    await trackCost(
      AGENT_NAME,
      modelAlias,
      usage?.input_tokens ?? 0,
      usage?.output_tokens ?? 0,
      telemetryContext
    );

    // withStructuredOutput({ includeRaw: true }) hands back parsed: null on a Zod
    // failure rather than throwing. Here that means the model produced something
    // that was not a valid forecast — which, for this node, is the same outcome as
    // having nothing to say. Degrade to silence rather than storing a malformed
    // claim; the ledger's whole value is that everything in it is resolvable.
    if (!parsed) {
      logger.warn("forecaster: structured output failed schema validation — emitting nothing", {
        competitor_id: state.competitor_id,
        run_id: state.run_id,
        failure: "invalid_structured_output",
      });
      return { forecasts: [] };
    }

    if (parsed.forecasts.length === 0) {
      logger.info("forecaster: model abstained", {
        competitor_id: state.competitor_id,
        run_id: state.run_id,
        abstained_reason: parsed.abstained_reason,
      });
      return { forecasts: [] };
    }

    const evidenceSignalIds = signals.map((signal) => signal.id);
    const stored: Forecast[] = [];

    for (const forecast of parsed.forecasts) {
      const resolvesAt = new Date(Date.now() + forecast.horizon_days * MS_PER_DAY);

      // One forecast failing to persist must not cost the others in this batch —
      // same per-item isolation the collectors apply.
      try {
        await createPrediction({
          workspace_id: state.workspace_id,
          competitor_id: state.competitor_id,
          run_id: state.run_id,
          statement: forecast.statement,
          pattern_type: forecast.pattern_type,
          probability: forecast.probability,
          resolution_criteria: forecast.resolution_criteria,
          horizon_days: forecast.horizon_days,
          resolves_at: resolvesAt,
          evidence_signal_ids: evidenceSignalIds,
          evidence_count: evidenceCount,
          status: "open",
        });
        stored.push(forecast);
      } catch (error) {
        logger.error("forecaster: failed to persist one prediction — continuing with the rest", {
          competitor_id: state.competitor_id,
          run_id: state.run_id,
          error,
        });
      }
    }

    return { forecasts: stored };
  });
}
