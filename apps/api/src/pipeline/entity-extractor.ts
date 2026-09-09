// Extracts structured entities (prices, product/feature names) from signal text into JSONB.
import type { Job } from "bullmq";
import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage } from "@langchain/core/messages";
import { SignalEntitiesSchema } from "@signal/shared";
import { withRetry } from "../lib/retry";
import { logger } from "../lib/logger";
import { registerWorker, queues } from "../queues/registry";
import { getSignalById, updateSignalEntities } from "../db/queries";
import { selectModel } from "../llm/adaptive-router";
import { getActivePrompt } from "../llm/prompt-registry";
import { trackCost } from "../llm/cost-tracker";
import { trackLatency } from "../lib/latency-tracker";

const AGENT_NAME = "entity_extractor" as const;
// Not a downgrade target of anything in adaptive-router's DOWNGRADE_MAP, so
// selectModel(..., true) always returns this literally — called anyway for
// consistency with every future LLM-calling agent in this codebase.
const PREFERRED_MODEL = "gpt-4o-mini";

const DEFAULT_PROMPT =
  "Extract every dollar-amount price, product name, and named feature mentioned in " +
  "the following text. Return empty arrays for any category with no matches — never " +
  "omit prices, products, or features from the result.";

interface EntityExtractionJobData {
  signal_id: string;
}

export async function entityExtractorProcessor(
  job: Job<EntityExtractionJobData>
): Promise<void> {
  const signal = await getSignalById(job.data.signal_id);
  if (!signal) {
    logger.warn("entity-extractor: signal not found — skipping", {
      signal_id: job.data.signal_id,
    });
    return;
  }

  // job.id is only optional on a not-yet-added Job — a worker-dispatched job
  // always has one, but fall back to the signal's own id rather than a cast
  // so trackLatency/trackCost's required/optional runId params stay honest.
  const runId = job.id ?? signal.id;

  const model = await selectModel(PREFERRED_MODEL, true);
  const promptText = (await getActivePrompt(AGENT_NAME)) ?? DEFAULT_PROMPT;

  const chatModel = new ChatOpenAI({ model });
  const structuredModel = chatModel.withStructuredOutput(SignalEntitiesSchema, {
    includeRaw: true,
  });

  const { raw, parsed } = await trackLatency(AGENT_NAME, signal.competitor_id, runId, () =>
    structuredModel.invoke([
      ["system", promptText],
      ["human", signal.raw_text],
    ])
  );

  const usage = (raw as AIMessage).usage_metadata;
  await trackCost(
    AGENT_NAME,
    model,
    usage?.input_tokens ?? 0,
    usage?.output_tokens ?? 0,
    runId,
    signal.competitor_id
  );

  await updateSignalEntities(signal.id, parsed);

  await withRetry(() =>
    queues["pipeline-quality-scoring"].add("score-quality", { signal_id: signal.id })
  );
}

// Extension point — must only be called from the standalone worker process
// entrypoint, same as every collector's initXWorker(). Not called here so
// importing this module never starts a live Worker as a side effect.
export function initEntityExtractorWorker() {
  return registerWorker("pipeline-entity-extraction", entityExtractorProcessor);
}
