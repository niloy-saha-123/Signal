// Classifies uploaded/pasted company material: structured facts (pricing, product
// description, differentiators) get extracted into company_profile fields; everything
// else is narrative and gets embedded for semantic search instead. Follows the same
// bounded-timeout + selectModel + trackCost pattern as agents/analysis/intent-analyzer.ts.
import { ChatAnthropic } from "@langchain/anthropic";
import type { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import { selectModel, ANTHROPIC_MODEL_IDS } from "../llm/adaptive-router";
import { trackCost } from "../llm/cost-tracker";
import { logger } from "./logger";

// No dedicated `document_classifier` AgentNameSchema value exists and this task adds no
// migration — attribute the call to entity_extractor (the closest existing agent: it
// already extracts structured prices/products/features from text) rather than inventing
// an enum value, same convention as citation-enforcer.ts / rag-faithfulness-judge.ts.
const AGENT_NAME = "entity_extractor" as const;
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;
const MODEL = "claude-haiku";

const ClassificationSchema = z.object({
  doc_type: z.enum(["pitch_deck", "financials", "website_snapshot", "other"]),
  mode: z.enum(["structured", "narrative"]),
  structured_fields: z
    .object({
      product_description: z.string().optional(),
      pricing_tiers: z
        .array(z.object({ name: z.string(), price: z.number(), billing: z.string() }))
        .optional(),
      key_differentiators: z.array(z.string()).optional(),
    })
    .optional(),
});

export type DocumentClassification = z.infer<typeof ClassificationSchema>;

const SYSTEM_PROMPT =
  "Classify this piece of company material. If it contains clearly structured facts " +
  "(pricing, product description, differentiators), extract them into structured_fields " +
  "and set mode='structured'. Otherwise set mode='narrative' with no structured_fields — " +
  "it will be indexed for semantic search instead.";

// A pricing line looks like "Starter: $29/month" — a label, a dollar amount, optionally
// a billing cadence. Two or more such lines is a reasonable signal this is a pricing table.
const PRICING_LINE_PATTERN = /\$\s?\d+(?:\.\d+)?/;
const ANNUAL_PATTERN = /year|yr|annual/i;
const MONTHLY_PATTERN = /month|\bmo\b/i;

// ponytail: keyword fallback, not a second classifier — good enough to keep ingestion
// working through an LLM outage instead of 500ing the upload; a wrong classification is
// correctable by re-uploading. Revisit if fallback-rate telemetry shows this firing often.
function heuristicClassify(text: string): DocumentClassification {
  const pricingLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(":") && PRICING_LINE_PATTERN.test(line));

  if (pricingLines.length < 2) {
    return { doc_type: "other", mode: "narrative" };
  }

  const pricing_tiers = pricingLines.map((line) => {
    const [name] = line.split(":");
    const priceMatch = line.match(/\$\s?(\d+(?:\.\d+)?)/);
    const billing = ANNUAL_PATTERN.test(line) ? "annual" : MONTHLY_PATTERN.test(line) ? "monthly" : "custom";
    return { name: name.trim(), price: priceMatch ? Number(priceMatch[1]) : 0, billing };
  });

  return { doc_type: "other", mode: "structured", structured_fields: { pricing_tiers } };
}

export async function classifyDocument(text: string): Promise<DocumentClassification> {
  const modelAlias = await selectModel(MODEL, true);

  try {
    const model = new ChatAnthropic({
      model: ANTHROPIC_MODEL_IDS[modelAlias] ?? modelAlias,
      // Unlike ChatOpenAI, ChatAnthropic's own input type has no top-level `timeout` —
      // the underlying Anthropic SDK client takes it via `clientOptions` instead.
      clientOptions: { timeout: LLM_TIMEOUT_MS },
      maxRetries: LLM_MAX_RETRIES,
    }).withStructuredOutput(ClassificationSchema, { includeRaw: true });

    const result = await model.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 24_000) },
    ]);

    // The call was made and billed whether or not the response parsed — track it first,
    // same ordering as every other structured-output LLM call in this codebase.
    const usage = (result.raw as AIMessage).usage_metadata;
    await trackCost(AGENT_NAME, modelAlias, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0);

    if (!result.parsed) {
      throw new Error("document classification failed structured-output validation");
    }

    return result.parsed;
  } catch (error) {
    logger.warn("document-classifier: LLM classification failed, using keyword fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    return heuristicClassify(text);
  }
}
