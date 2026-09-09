// Shared text-embedding helper. deduplicator.ts (Part 7 Task 4) embeds every signal's
// raw_text exactly once, keyed by the signal's own id, per the embed-step ruling in
// .claude/loop/07-pipeline.md.
//
// Retry lives in the client, not in a withRetry wrapper: LangChain's AsyncCaller already
// retries with backoff, and stacking our own on top multiplied the two layers together.
// Both bounds are explicit because the defaults (openai-node's 10-minute timeout ×
// AsyncCaller's maxRetries: 6) can hold a worker slot for ~70 minutes on a hung endpoint.
import { OpenAIEmbeddings } from "@langchain/openai";

const EMBEDDING_TIMEOUT_MS = 15_000;
const EMBEDDING_MAX_RETRIES = 2;

let embeddings: OpenAIEmbeddings | undefined;

function getEmbeddings(): OpenAIEmbeddings {
  if (!embeddings) {
    embeddings = new OpenAIEmbeddings({
      model: "text-embedding-3-small",
      timeout: EMBEDDING_TIMEOUT_MS,
      maxRetries: EMBEDDING_MAX_RETRIES,
    });
  }
  return embeddings;
}

export async function embedText(text: string): Promise<number[]> {
  return getEmbeddings().embedQuery(text);
}
