// LangGraph node — SQL volume aggregation plus GPT-4o trend synthesis over Pinecone signals.
// Phase 2 (after 90 days of accumulation): retrieves historically similar signal patterns for this
// competitor from Pinecone and weights current predictions by what happened after past occurrences.
//
// Phase 2 retrieval now uses hybridRetrieve() (BM25 + semantic) instead of semantic-only Pinecone
// query. This improves recall for specific terms (competitor names, exact pricing figures, product
// feature names) that vector search sometimes misses. Results are NOT reranked — PatternDetector
// processes all 150 chunks, and reranking would discard potentially relevant trend signals.
// P50/P95 tracked via latency-tracker.ts.
import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AnalysisGraphState, PatternsResult } from "../../graph/state";
import { logger } from "../../lib/logger";
import { getCompanyContext } from "../../lib/company-context";
import { getSignalVolumeByDay, getFirstSignalCollectedAt, type SignalVolumeByDay } from "../../db/queries";
import { hybridRetrieve, type RetrievedChunk } from "../../retrieval";
import { trackLatency } from "../../lib/latency-tracker";
import { trackCost } from "../../llm/cost-tracker";
import { selectModel } from "../../llm/adaptive-router";
import { getActivePrompt } from "../../llm/prompt-registry";
import { runBranchNode, isLlmBudgetExhausted } from "./branch-node";

const AGENT_NAME = "pattern_detector" as const;
const MODEL = "gpt-4o";

// Bounded client budget — same reasoning as change-detector.ts/intent-analyzer.ts:
// LangChain's defaults can hold a call open far longer than this pipeline can tolerate
// on a hung endpoint.
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;

// Same "don't blow the context window" reasoning as intent-analyzer.ts's
// INTENT_ANALYZER_INPUT_MAX_LENGTH — Phase 2 can hand this node up to 150 chunks.
export const PATTERN_DETECTOR_INPUT_MAX_LENGTH = 24_000;

// Phase 2 gate: skip retrieval entirely unless the competitor has at least this much
// accumulated history — per the file header, temporal pattern-matching only becomes
// meaningful once there's a real "before" to compare against.
const PHASE_2_MIN_HISTORY_DAYS = 90;
const PHASE_2_MIN_HISTORY_MS = PHASE_2_MIN_HISTORY_DAYS * 24 * 60 * 60 * 1000;

// hybridRetrieve's topK per the Part-10 spec — deliberately not reranked/truncated
// downstream (see file header).
const PHASE_2_RETRIEVAL_TOP_K = 150;

const PatternsSchema = z.object({
  summary: z.string(),
  trend: z.enum(["increasing", "decreasing", "stable"]),
});

const SYSTEM_PROMPT_BASE =
  "Analyze the following signal volume trend for a competitor over the last 30 days. If " +
  "historically similar signals from this competitor's accumulated history (90+ days) are " +
  "also included, weigh them alongside the volume data — what happened after similar past " +
  "occurrences is a stronger trend signal than volume counts alone. Classify the overall " +
  "trend as increasing, decreasing, or stable, and write a brief summary of what's driving it.";

// Naive heuristic (first-half vs second-half average count) used ONLY to pick a retrieval
// query string for Phase 2 — the actual trend classification is the LLM's job below, given
// the full volume data plus (when available) the retrieved chunks.
function inferNaiveTrendDirection(volumeByDay: SignalVolumeByDay[]): "increasing" | "decreasing" | "stable" {
  if (volumeByDay.length < 2) return "stable";
  const midpoint = Math.floor(volumeByDay.length / 2);
  const avg = (days: SignalVolumeByDay[]) =>
    days.reduce((sum, d) => sum + d.count, 0) / days.length;
  const firstAvg = avg(volumeByDay.slice(0, midpoint));
  const secondAvg = avg(volumeByDay.slice(midpoint));
  if (secondAvg > firstAvg * 1.1) return "increasing";
  if (secondAvg < firstAvg * 0.9) return "decreasing";
  return "stable";
}

// Query string picked for hybridRetrieve: a short string synthesized from the Phase 1
// volume trend (per the task brief's two documented options), not the competitor's
// name/domain — that would need an extra getCompetitorById round-trip this node otherwise
// has no reason to make, since Phase 1's own data already gives us something to search on.
function buildPhase2Query(volumeByDay: SignalVolumeByDay[]): string {
  return `${inferNaiveTrendDirection(volumeByDay)} competitor signal activity over the last 30 days`;
}

function formatVolumeByDay(volumeByDay: SignalVolumeByDay[]): string {
  if (volumeByDay.length === 0) return "No signal volume recorded in the last 30 days.";
  return volumeByDay
    .map((d) => `${d.day}: ${d.count} signals (weighted ${d.weighted_count})`)
    .join("\n");
}

function buildContextText(volumeByDay: SignalVolumeByDay[], chunks: RetrievedChunk[]): string {
  const sections = [`Signal volume by day (last 30 days):\n${formatVolumeByDay(volumeByDay)}`];
  if (chunks.length > 0) {
    sections.push(
      `Historically similar signals (90+ days of accumulated history):\n${chunks
        .map((chunk) => chunk.text)
        .join("\n\n---\n\n")}`
    );
  }
  return sections.join("\n\n").slice(0, PATTERN_DETECTOR_INPUT_MAX_LENGTH);
}

export async function patternDetectorNode(
  state: typeof AnalysisGraphState.State
): Promise<Partial<typeof AnalysisGraphState.State>> {
  return runBranchNode(AGENT_NAME, state, async () => {
    // trackLatency wraps the whole node (Phase 1 SQL + the Phase 2 gate/retrieval fan-out +
    // the LLM call) as one span — unlike Tasks 2-4, which only wrapped the LLM call, because
    // the SQL/retrieval cost here is a real, variable part of this node's latency budget.
    // The callback returns a discriminated outcome so the empty-input and budget-exhausted
    // paths can skip the LLM call while keeping Phase 1/2 inside the measured span.
    const outcome = await trackLatency(
      AGENT_NAME,
      state.competitor_id,
      state.run_id,
      async (): Promise<
        | { kind: "empty" }
        | { kind: "budget" }
        | { kind: "llm"; model: string; raw: unknown; parsed: PatternsResult | null }
      > => {
        const volumeByDay = await getSignalVolumeByDay(state.competitor_id, 30);

        const firstCollectedAt = await getFirstSignalCollectedAt(state.competitor_id);
        const hasNinetyDaysHistory =
          firstCollectedAt !== undefined &&
          firstCollectedAt.getTime() <= Date.now() - PHASE_2_MIN_HISTORY_MS;

        const chunks = hasNinetyDaysHistory
          ? await hybridRetrieve(
              buildPhase2Query(volumeByDay),
              [state.competitor_id],
              PHASE_2_RETRIEVAL_TOP_K
            )
          : [];

        // ts-review M3: nothing to analyze — no volume data and no retrieved history.
        // Return a real "we looked, there's nothing" result, no LLM call (same as the other
        // four nodes' empty-input short-circuits).
        if (volumeByDay.length === 0 && chunks.length === 0) {
          return { kind: "empty" };
        }

        // H3: hard budget stop, immediately before the LLM call.
        if (await isLlmBudgetExhausted(AGENT_NAME, state)) {
          return { kind: "budget" };
        }

        const model = await selectModel(MODEL, true);
        const promptText = (await getActivePrompt(AGENT_NAME)) ?? SYSTEM_PROMPT_BASE;

        const companyContext = await getCompanyContext();
        const systemPrompt = companyContext ? `${promptText}\n\n${companyContext}` : promptText;

        const chatModel = new ChatOpenAI({
          model,
          timeout: LLM_TIMEOUT_MS,
          maxRetries: LLM_MAX_RETRIES,
        });
        const structuredModel = chatModel.withStructuredOutput(PatternsSchema, {
          includeRaw: true,
        });

        const { raw, parsed } = await structuredModel.invoke([
          ["system", systemPrompt],
          ["human", buildContextText(volumeByDay, chunks)],
        ]);
        return { kind: "llm", model, raw, parsed: parsed as PatternsResult | null };
      }
    );

    if (outcome.kind === "empty") {
      return { patterns: { summary: "No recent signal activity to analyze.", trend: "stable" } };
    }
    if (outcome.kind === "budget") {
      return {};
    }

    // The call was made and billed whether or not the response parsed — track it first.
    const usage = (outcome.raw as AIMessage).usage_metadata;
    await trackCost(
      AGENT_NAME,
      outcome.model,
      usage?.input_tokens ?? 0,
      usage?.output_tokens ?? 0,
      state.run_id,
      state.competitor_id
    );

    // withStructuredOutput({ includeRaw: true }) does NOT throw on a Zod validation
    // failure — it hands back parsed: null while the TS type still claims PatternsResult.
    // Returning that straight through would silently write a null patterns and report
    // success. runBranchNode catches this throw and degrades the branch to `{}` so the
    // synthesis fan-in still completes.
    if (!outcome.parsed) {
      logger.error("pattern-detector: structured output failed schema validation", {
        competitor_id: state.competitor_id,
        run_id: state.run_id,
        raw_content: (outcome.raw as AIMessage)?.content,
      });
      throw new Error(
        `pattern-detector: structured output failed schema validation for competitor ${state.competitor_id}`
      );
    }

    const patterns: PatternsResult = outcome.parsed;
    return { patterns };
  });
}
