// Central model router that selects the optimal LLM per agent task from a single configuration point.
export type AgentTask =
  | "intent-analyzer"
  | "sentiment-clusterer"
  | "change-detector"
  | "pattern-detector"
  | "vulnerability-analysis"
  | "vulnerability-copy"
  | "synthesis"
  | "chat";

export interface ModelConfig {
  provider: "openai" | "anthropic";
  model: string;
}

export function selectModel(task: AgentTask): ModelConfig {
  const routing: Record<AgentTask, ModelConfig> = {
    "intent-analyzer": { provider: "openai", model: "gpt-4o" },
    "sentiment-clusterer": { provider: "anthropic", model: "claude-3-haiku-20240307" },
    "change-detector": { provider: "openai", model: "gpt-4o-mini" },
    "pattern-detector": { provider: "openai", model: "gpt-4o" },
    "vulnerability-analysis": { provider: "openai", model: "gpt-4o" },
    "vulnerability-copy": { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
    synthesis: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
    chat: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
  };
  return routing[task];
}
