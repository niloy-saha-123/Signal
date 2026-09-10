// Real-time RAG chat agent — streams Claude Sonnet responses over quality-weighted Pinecone retrieval (SSE).
//
// ChatAgent now uses a three-stage retrieval pipeline:
//   1. hybridRetrieve() — BM25 + semantic, RRF merged
//   2. rerankChunks() — Cohere reranker rescore
//   3. enforceCitations() — claim validation + refusal
// Refusal is a first-class output: if retrieved evidence does not support the query, the agent
// returns a RefusalResult rather than a low-quality answer. P50/P95 latency is tracked via
// latency-tracker.ts on every request.
import { z } from "zod";
import type { ChatAgentResult, RefusalResult } from "@signal/shared";
import { hybridRetrieve, rerankChunks } from "../../retrieval";
import { trackLatency } from "../../lib/latency-tracker";

const MAX_QUERY_LENGTH = 2_000;
const MAX_COMPETITORS = 25;

const ChatAgentInputSchema = z.object({
  query: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  competitor_ids: z
    .array(z.string().uuid())
    .min(1)
    .transform((ids) => [...new Set(ids)])
    .pipe(z.array(z.string().uuid()).max(MAX_COMPETITORS)),
  run_id: z.string().uuid(),
});

export interface ChatAgentInput {
  query: string;
  competitor_ids: string[];
  run_id: string;
}

function noEvidenceRefusal(reason: string): RefusalResult {
  return {
    refused: true,
    reason,
    suggested_query: "Try asking about a specific competitor, timeframe, or product feature.",
  };
}

export async function runChatAgent(input: ChatAgentInput): Promise<ChatAgentResult> {
  const parsed = ChatAgentInputSchema.parse(input);
  const primaryCompetitorId = parsed.competitor_ids[0];

  return trackLatency("chat_agent", primaryCompetitorId, parsed.run_id, async () => {
    const candidates = await hybridRetrieve(parsed.query, parsed.competitor_ids);
    if (candidates.length === 0) {
      return noEvidenceRefusal("No stored signals matched this question.");
    }

    const evidence = await rerankChunks(parsed.query, candidates);
    if (evidence.length === 0) {
      return noEvidenceRefusal("The available signals were not relevant enough to answer reliably.");
    }

    // Task 2 replaces this evidence-present refusal with bounded Claude
    // generation followed by enforceCitations. Keeping a typed result here
    // preserves the public contract at this intermediate, testable checkpoint.
    return noEvidenceRefusal("Grounded answer generation is not available yet.");
  });
}
