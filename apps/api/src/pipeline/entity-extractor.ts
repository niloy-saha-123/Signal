// Extracts structured entities (prices, product/feature names) from signal text into JSONB.
import type { Job } from "bullmq";
import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage } from "@langchain/core/messages";
import { SignalEntitiesSchema } from "@signal/shared";
import { withRetry } from "../lib/retry";
import { logger } from "../lib/logger";
import { registerWorker, queues } from "../queues/registry";
import { getSignalById, updateSignalEntities, type Signal } from "../db/queries";
import { selectModel, getDailyBudget } from "../llm/adaptive-router";
import { getActivePrompt } from "../llm/prompt-registry";
import { trackCost, getDailySpend } from "../llm/cost-tracker";
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

// Bounded client budget. LangChain's defaults (openai-node's 10-minute request
// timeout × AsyncCaller's maxRetries: 6) let one hung request hold a worker slot
// for ~70 minutes; the queue only runs concurrency 2.
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;

interface EntityExtractionJobData {
  signal_id: string;
}

// "Already extracted" = a prior attempt produced at least one entity. An extraction
// that genuinely found nothing looks identical to the default `{}` here and will be
// re-run on a retry — cheap, and far better than permanently skipping a signal whose
// first attempt half-failed.
function hasExtractedEntities(entities: Record<string, unknown> | null): boolean {
  return Object.values(entities ?? {}).some((value) => Array.isArray(value) && value.length > 0);
}

async function extractEntities(signal: Signal, runId: string): Promise<void> {
  if (hasExtractedEntities(signal.entities)) {
    logger.info("entity-extractor: entities already populated — skipping LLM call", {
      signal_id: signal.id,
    });
    return;
  }

  // selectModel never reaches its own budget check for gpt-4o-mini (not a
  // DOWNGRADE_MAP key, so it returns early), so the daily cap has to be enforced
  // here or not at all. getDailySpend() fails safe to Infinity on a DB error —
  // skipping extraction during a Postgres outage is the intended behaviour.
  const budget = getDailyBudget();
  const spend = await getDailySpend();
  if (spend >= budget) {
    logger.warn("entity-extractor: daily LLM budget reached — skipping extraction", {
      signal_id: signal.id,
      spend,
      budget,
    });
    return;
  }

  const model = await selectModel(PREFERRED_MODEL, true);
  const promptText = (await getActivePrompt(AGENT_NAME)) ?? DEFAULT_PROMPT;

  const chatModel = new ChatOpenAI({
    model,
    timeout: LLM_TIMEOUT_MS,
    maxRetries: LLM_MAX_RETRIES,
  });
  const structuredModel = chatModel.withStructuredOutput(SignalEntitiesSchema, {
    includeRaw: true,
  });

  const { raw, parsed } = await trackLatency(AGENT_NAME, signal.competitor_id, runId, () =>
    structuredModel.invoke([
      ["system", promptText],
      ["human", signal.raw_text],
    ])
  );

  // The call was made and billed whether or not the response parsed — track it first.
  const usage = (raw as AIMessage).usage_metadata;
  await trackCost(
    AGENT_NAME,
    model,
    usage?.input_tokens ?? 0,
    usage?.output_tokens ?? 0,
    runId,
    signal.competitor_id
  );

  // withStructuredOutput({ includeRaw: true }) does NOT throw on a Zod validation
  // failure — it hands back parsed: null while the TS type still claims
  // SignalEntities. Writing that straight through would set entities to NULL and
  // report success.
  if (!parsed) {
    logger.error("entity-extractor: structured output failed schema validation", {
      signal_id: signal.id,
      model,
      raw_content: (raw as AIMessage)?.content,
    });
    throw new Error(
      `entity-extractor: structured output failed schema validation for signal ${signal.id}`
    );
  }

  await updateSignalEntities(signal.id, parsed);
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

  // Entity extraction is enrichment; quality-scoring and Pinecone indexing (the
  // deduplicator is the only place a signal ever gets embedded) are not. An OpenAI
  // outage must not strand the signal before those, so a failure here is logged and
  // the chain advances with entities left empty. There's no reconciliation sweeper —
  // that is deliberate: coverage of entities matters less than every signal being
  // scored and retrievable.
  try {
    await extractEntities(signal, runId);
  } catch (err) {
    logger.error("entity-extractor: extraction failed — advancing pipeline without entities", {
      signal_id: signal.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

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
