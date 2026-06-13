// Middleware that logs token usage, latency, and cost for every LLM call to PostgreSQL.
export interface LLMCallMetrics {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}

export async function trackLLMCall(metrics: LLMCallMetrics): Promise<void> {
  // TODO: persist to llm_costs table
  void metrics;
}
