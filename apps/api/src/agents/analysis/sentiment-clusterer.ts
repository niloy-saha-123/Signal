// LangGraph node — clusters sentiment signals into new vs. chronic complaints (Claude Haiku).
import { ChatAnthropic } from "@langchain/anthropic";
import type { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AnalysisGraphState, SentimentClustersResult } from "../../graph/state";
import { logger } from "../../lib/logger";
import { getCompanyContext } from "../../lib/company-context";
import { getRecentSignalsByCompetitorAndSource, type Signal } from "../../db/queries";
import { trackLatency } from "../../lib/latency-tracker";
import { trackCost } from "../../llm/cost-tracker";
import { selectModel } from "../../llm/adaptive-router";

const AGENT_NAME = "sentiment_clusterer" as const;
// Same reasoning as pipeline/entity-extractor.ts calling selectModel(PREFERRED_MODEL, true) —
// "claude-haiku" has no downgrade target of its own in adaptive-router's DOWNGRADE_MAP, so
// this always returns unchanged, but the call stays for consistency with every LLM-calling
// agent in this codebase.
const PREFERRED_MODEL = "claude-haiku";

// "claude-haiku" is this codebase's internal cost-tracking/routing alias only
// (llm/cost-tracker.ts's PRICING_PER_MILLION_TOKENS key, llm/adaptive-router.ts's
// DOWNGRADE_MAP value) — not a valid Anthropic API model string. Translate it here for the
// actual ChatAnthropic constructor; trackCost still gets the alias below, same as every
// other model passed to it in this codebase.
const ANTHROPIC_MODEL_IDS: Record<string, string> = {
  "claude-haiku": "claude-haiku-4-5-20251001",
};

// Bounded client budget — same reasoning as pipeline/entity-extractor.ts and
// intent-analyzer.ts: LangChain's defaults can hold a call open far longer than this
// pipeline can tolerate on a hung endpoint.
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;

// Same "don't blow the context window" reasoning as intent-analyzer.ts's
// INTENT_ANALYZER_INPUT_MAX_LENGTH / deduplicator.ts's EMBEDDING_TEXT_MAX_LENGTH.
export const SENTIMENT_CLUSTERER_INPUT_MAX_LENGTH = 24_000;

const SentimentClustersSchema = z.object({
  summary: z.string(),
  new_complaints: z.array(z.string()),
  chronic_complaints: z.array(z.string()),
});

const SYSTEM_PROMPT_BASE =
  "Analyze the following recent Reddit and Hacker News discussion about a competitor. " +
  "Cluster the sentiment into new_complaints (raised for the first time recently) and " +
  "chronic_complaints (recurring, long-standing issues), and write a brief overall summary.";

function buildSignalsText(signals: Signal[]): string {
  const text = signals
    .map((signal) => (signal.title ? `${signal.title}\n\n${signal.raw_text}` : signal.raw_text))
    .join("\n\n---\n\n");
  return text.slice(0, SENTIMENT_CLUSTERER_INPUT_MAX_LENGTH);
}

export async function sentimentClustererNode(
  state: typeof AnalysisGraphState.State
): Promise<Partial<typeof AnalysisGraphState.State>> {
  const [redditSignals, hnSignals] = await Promise.all([
    getRecentSignalsByCompetitorAndSource(state.competitor_id, "reddit", 7),
    getRecentSignalsByCompetitorAndSource(state.competitor_id, "hn", 7),
  ]);
  const signals = [...redditSignals, ...hnSignals];

  if (signals.length === 0) {
    return {
      sentiment_clusters: {
        summary: "No recent community discussion found.",
        new_complaints: [],
        chronic_complaints: [],
      },
    };
  }

  const companyContext = await getCompanyContext();
  const systemPrompt = companyContext
    ? `${SYSTEM_PROMPT_BASE}\n\n${companyContext}`
    : SYSTEM_PROMPT_BASE;

  const model = await selectModel(PREFERRED_MODEL, true);

  const chatModel = new ChatAnthropic({
    model: ANTHROPIC_MODEL_IDS[model] ?? model,
    // Unlike ChatOpenAI, ChatAnthropic's own input type has no top-level `timeout` —
    // the underlying Anthropic SDK client takes it via `clientOptions` instead.
    clientOptions: { timeout: LLM_TIMEOUT_MS },
    maxRetries: LLM_MAX_RETRIES,
  });
  const structuredModel = chatModel.withStructuredOutput(SentimentClustersSchema, {
    includeRaw: true,
  });

  const { raw, parsed } = await trackLatency(AGENT_NAME, state.competitor_id, state.run_id, () =>
    structuredModel.invoke([
      ["system", systemPrompt],
      ["human", buildSignalsText(signals)],
    ])
  );

  // The call was made and billed whether or not the response parsed — track it first.
  const usage = (raw as AIMessage).usage_metadata;
  await trackCost(
    AGENT_NAME,
    model,
    usage?.input_tokens ?? 0,
    usage?.output_tokens ?? 0,
    state.run_id,
    state.competitor_id
  );

  // withStructuredOutput({ includeRaw: true }) does NOT throw on a Zod validation
  // failure — it hands back parsed: null while the TS type still claims
  // SentimentClustersResult. Returning that straight through would silently write a
  // null sentiment_clusters and report success.
  if (!parsed) {
    logger.error("sentiment-clusterer: structured output failed schema validation", {
      competitor_id: state.competitor_id,
      run_id: state.run_id,
      raw_content: (raw as AIMessage)?.content,
    });
    throw new Error(
      `sentiment-clusterer: structured output failed schema validation for competitor ${state.competitor_id}`
    );
  }

  const sentiment_clusters: SentimentClustersResult = parsed;
  return { sentiment_clusters };
}
