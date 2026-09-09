// Per-call token/cost accounting, logged to Postgres for the llm_costs table.
import { gte } from "drizzle-orm";
import type { AgentName } from "@signal/shared";
import { db } from "../db/client";
import { llmCostsTable } from "../db/schema";
import { logger } from "../lib/logger";

const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "claude-sonnet": { input: 3.0, output: 15.0 },
  "claude-haiku": { input: 0.8, output: 4.0 },
};

export async function trackCost(
  agentName: AgentName,
  model: string,
  inputTokens: number,
  outputTokens: number,
  runId?: string,
  competitorId?: string
): Promise<number> {
  const pricing = PRICING_PER_MILLION_TOKENS[model];
  if (!pricing) {
    throw new Error(`Unknown model for cost tracking: ${model}`);
  }

  const cost =
    (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;

  try {
    await db.insert(llmCostsTable).values({
      run_id: runId ?? null,
      competitor_id: competitorId ?? null,
      agent_name: agentName,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: cost.toFixed(6),
    });
  } catch (error) {
    // Telemetry must never mask the real LLM call result — log and swallow,
    // same pattern as trackLatency (lib/latency-tracker.ts).
    logger.error("Failed to record llm_costs row", { error, agentName, model });
  }

  return cost;
}

export async function getDailySpend(): Promise<number> {
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  try {
    const rows = await db
      .select({ cost_usd: llmCostsTable.cost_usd })
      .from(llmCostsTable)
      .where(gte(llmCostsTable.created_at, startOfToday));

    return rows.reduce((sum, row) => sum + Number(row.cost_usd), 0);
  } catch (error) {
    // Budget safety must fail safe: an unknown spend total must never look
    // like $0 (which would fail open and let selectModel proceed at full
    // price). Infinity guarantees a downgrade whenever eligible.
    logger.error("Failed to compute daily LLM spend", { error });
    return Infinity;
  }
}
