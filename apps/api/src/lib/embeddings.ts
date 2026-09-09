// Shared text-embedding helper. deduplicator.ts (Part 7 Task 4) embeds every signal's
// raw_text exactly once, keyed by the signal's own id, per the embed-step ruling in
// .claude/loop/07-pipeline.md. Wrapped in withRetry, same pattern as every other
// external-API call in this codebase (see vector/pinecone.ts).
import { OpenAIEmbeddings } from "@langchain/openai";
import { withRetry } from "./retry";

let embeddings: OpenAIEmbeddings | undefined;

function getEmbeddings(): OpenAIEmbeddings {
  if (!embeddings) {
    embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-small" });
  }
  return embeddings;
}

export async function embedText(text: string): Promise<number[]> {
  return withRetry(() => getEmbeddings().embedQuery(text));
}
