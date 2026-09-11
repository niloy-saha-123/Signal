// LangGraph node — infers competitor hiring intent from recent job postings (GPT-4o).
import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AnalysisGraphState, HiringIntentResult } from "../../graph/state";
import { logger } from "../../lib/logger";
import { getCompanyContext } from "../../lib/company-context";
import { getRecentSignalsByCompetitorAndSource, type Signal } from "../../db/queries";
import { trackLatency } from "../../lib/latency-tracker";
import { trackCost } from "../../llm/cost-tracker";
import { selectModel } from "../../llm/adaptive-router";
import { getActivePrompt } from "../../llm/prompt-registry";
import { runBranchNode, isLlmBudgetExhausted } from "./branch-node";

const AGENT_NAME = "intent_analyzer" as const;
const MODEL = "gpt-4.1";

// Bounded client budget — same reasoning as pipeline/entity-extractor.ts: LangChain's
// defaults (openai-node's 10-minute request timeout × AsyncCaller's maxRetries: 6) can
// hold a call open for ~70 minutes on a hung endpoint.
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;

// Same "don't blow the context window" reasoning as pipeline/deduplicator.ts's
// EMBEDDING_TEXT_MAX_LENGTH — this is a chat-completion input rather than an embedding,
// but concatenated Greenhouse/Lever job postings can still run arbitrarily long.
export const INTENT_ANALYZER_INPUT_MAX_LENGTH = 24_000;

const HiringIntentSchema = z.object({
  summary: z.string(),
  intent_level: z.enum(["low", "medium", "high"]),
});

const SYSTEM_PROMPT_BASE =
  "Analyze the following recent job postings from a competitor and infer their hiring " +
  "intent — what roles they are hiring for and what it signals about their product or " +
  "go-to-market direction. Classify overall intent_level as low, medium, or high.";

function buildPostingsText(signals: Signal[]): string {
  const text = signals
    .map((signal) => (signal.title ? `${signal.title}\n\n${signal.raw_text}` : signal.raw_text))
    .join("\n\n---\n\n");
  return text.slice(0, INTENT_ANALYZER_INPUT_MAX_LENGTH);
}

export async function intentAnalyzerNode(
  state: typeof AnalysisGraphState.State
): Promise<Partial<typeof AnalysisGraphState.State>> {
  return runBranchNode(AGENT_NAME, state, async () => {
    const postings = await getRecentSignalsByCompetitorAndSource(state.competitor_id, "jobs", 7);

    if (postings.length === 0) {
      return {
        hiring_intent: { summary: "No recent job postings found.", intent_level: "low" },
      };
    }

    // H3: hard budget stop, immediately before the LLM call and after the genuine
    // empty-input short-circuit. A `{}` here means "budget exhausted, couldn't determine".
    if (await isLlmBudgetExhausted(AGENT_NAME, state)) return {};

    const model = await selectModel(MODEL, true);
    const promptText = (await getActivePrompt(AGENT_NAME)) ?? SYSTEM_PROMPT_BASE;

    const companyContext = await getCompanyContext();
    const systemPrompt = companyContext ? `${promptText}\n\n${companyContext}` : promptText;

    const chatModel = new ChatOpenAI({
      model,
      timeout: LLM_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
    });
    const structuredModel = chatModel.withStructuredOutput(HiringIntentSchema, {
      includeRaw: true,
    });

    const { raw, parsed } = await trackLatency(AGENT_NAME, state.competitor_id, state.run_id, () =>
      structuredModel.invoke([
        ["system", systemPrompt],
        ["human", buildPostingsText(postings)],
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
    // HiringIntentResult. Returning that straight through would silently write a null
    // hiring_intent and report success. runBranchNode catches this throw and degrades the
    // branch to `{}` so the synthesis fan-in still completes.
    if (!parsed) {
      logger.error("intent-analyzer: structured output failed schema validation", {
        competitor_id: state.competitor_id,
        run_id: state.run_id,
        raw_content: (raw as AIMessage)?.content,
      });
      throw new Error(
        `intent-analyzer: structured output failed schema validation for competitor ${state.competitor_id}`
      );
    }

    const hiring_intent: HiringIntentResult = parsed;
    return { hiring_intent };
  });
}
