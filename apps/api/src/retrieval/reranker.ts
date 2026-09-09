// Reranker — wraps the Cohere reranking API.
// Used by: ChatAgent (stage 2 of its three-stage retrieval pipeline), after hybridRetrieve().
//
// Takes a query string and a list of candidate chunks (output of hybridRetrieve) and sends them
// to Cohere's rerank-english-v3.0 model, which scores each (query, chunk) pair jointly rather than
// comparing independently-computed embeddings. Returns chunks sorted by relevance score descending,
// filtering out anything below a minimum relevance threshold (default: 0.4, see
// RERANKER_MIN_RELEVANCE_SCORE in .env.example).
//
// Why this matters: vector similarity measures embedding proximity, not actual query relevance.
// A reranker evaluates the chunk in the context of the specific query, which consistently improves
// precision over top-k retrieval alone.
//
// Cost: the Cohere reranker free tier is 1000 calls/month. Reranker results are cached in Redis
// at a 2h TTL for identical (query, chunk_ids) pairs to reduce cost under repeat queries.
import { createHash } from "node:crypto";
import { CohereClient } from "cohere-ai";
import { withRetry } from "../lib/retry";
import { cacheRedis } from "../lib/redis-client";
import type { RetrievedChunk } from "./hybrid-retrieval";

export interface RerankedChunk extends RetrievedChunk {
  relevance_score: number;
}

const CACHE_TTL_SECONDS = 7200;

// Chunk id count is unbounded — hash rather than use the raw "query|id,id,..." string
// directly as the Redis key.
function buildCacheKey(query: string, chunks: RetrievedChunk[]): string {
  const sortedIds = chunks
    .map((c) => c.id)
    .sort()
    .join(",");
  return createHash("sha256").update(`${query}|${sortedIds}`).digest("hex");
}

export async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  topK: number = Number(process.env.RERANKER_TOP_K) || 10
): Promise<RerankedChunk[]> {
  // Nothing to rerank, and an empty `documents` array is a guaranteed Cohere API error,
  // not a zero-result response.
  if (chunks.length === 0) {
    return [];
  }

  const cacheKey = buildCacheKey(query, chunks);
  const cached = await cacheRedis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as RerankedChunk[];
  }

  const client = new CohereClient({ token: process.env.COHERE_API_KEY });
  const response = await withRetry(() =>
    client.rerank({
      model: "rerank-english-v3.0",
      query,
      documents: chunks.map((c) => ({ text: c.text })),
      topN: topK,
    })
  );

  const minRelevanceScore = Number(process.env.RERANKER_MIN_RELEVANCE_SCORE) || 0.4;
  // response.results arrive pre-sorted by relevance descending — don't re-sort.
  // result.index is the position in the `documents` array we sent, not a chunk id.
  const result: RerankedChunk[] = response.results
    .map((r) => ({ ...chunks[r.index], relevance_score: r.relevanceScore }))
    .filter((c) => c.relevance_score >= minRelevanceScore);

  await cacheRedis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
  return result;
}
