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
// at a 2h TTL for identical query, candidate IDs, and ranking policy to reduce cost under
// repeat queries without reusing results admitted under different thresholds or limits.
import { createHash } from "node:crypto";
import { CohereClient } from "cohere-ai";
import { z } from "zod";
import { SignalSourceSchema } from "@signal/shared";
import { withRetry } from "../lib/retry";
import { cacheRedis } from "../lib/redis-client";
import { logger } from "../lib/logger";
import { parseNumericSetting } from "../lib/numeric-config";
import type { RetrievedChunk } from "./hybrid-retrieval";

export interface RerankedChunk extends RetrievedChunk {
  relevance_score: number;
}

const CACHE_TTL_SECONDS = 7200;
// Same 15-30s bound every other external client in this codebase uses (lib/embeddings.ts,
// citation-enforcer.ts's ChatOpenAI) — Node's fetch has no default timeout, and a hang here
// never throws, so withRetry never even gets a chance to retry.
const COHERE_TIMEOUT_SECONDS = 15;

let cohereClient: CohereClient | undefined;

const RerankedChunkSchema = z
  .object({
    id: z.string().min(1),
    competitor_id: z.string().min(1),
    source: SignalSourceSchema,
    source_url: z.string().nullable(),
    text: z.string(),
    quality_score: z.number().finite().min(0).max(1),
    origin: z.enum(["bm25", "semantic", "both"]),
    rrf_score: z.number().finite().nonnegative(),
    relevance_score: z.number().finite().min(0).max(1),
  })
  .strict();

const CachedRerankedChunksSchema = z.array(RerankedChunkSchema);
const CohereResponseSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      relevanceScore: z.number().finite().min(0).max(1),
    })
  ),
});

function getCohereClient(): CohereClient {
  if (!cohereClient) {
    cohereClient = new CohereClient({
      token: process.env.COHERE_API_KEY,
      timeoutInSeconds: COHERE_TIMEOUT_SECONDS,
    });
  }
  return cohereClient;
}

// Chunk id count is unbounded — hash rather than use the raw "query|id,id,..." string
// directly as the Redis key.
function buildCacheKey(
  query: string,
  chunks: RetrievedChunk[],
  topK: number,
  minRelevanceScore: number
): string {
  const sortedIds = chunks
    .map((c) => c.id)
    .sort()
    .join(",");
  return createHash("sha256")
    .update(`${query}|${sortedIds}|${topK}|${minRelevanceScore}`)
    .digest("hex");
}

export async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  topK?: number
): Promise<RerankedChunk[]> {
  // Nothing to rerank, and an empty `documents` array is a guaranteed Cohere API error,
  // not a zero-result response.
  if (chunks.length === 0) {
    return [];
  }

  const resolvedTopK = parseNumericSetting(
    "RERANKER_TOP_K",
    topK ?? process.env.RERANKER_TOP_K,
    { defaultValue: 10, min: 1, max: 100, integer: true }
  );
  const minRelevanceScore = parseNumericSetting(
    "RERANKER_MIN_RELEVANCE_SCORE",
    process.env.RERANKER_MIN_RELEVANCE_SCORE,
    { defaultValue: 0.4, min: 0, max: 1 }
  );

  const cacheKey = buildCacheKey(query, chunks, resolvedTopK, minRelevanceScore);
  const cached = await cacheRedis.get(cacheKey);
  if (cached) {
    try {
      const parsed = CachedRerankedChunksSchema.parse(JSON.parse(cached));
      const candidateIds = new Set(chunks.map((chunk) => chunk.id));
      const cachedIds = parsed.map((chunk) => chunk.id);
      if (
        cachedIds.some((id) => !candidateIds.has(id)) ||
        new Set(cachedIds).size !== cachedIds.length
      ) {
        throw new Error("cached rerank result is outside the current candidate set");
      }
      return parsed;
    } catch {
      logger.warn("rerankChunks: failed to parse cached value — treating as cache miss", {
        cache_key: cacheKey,
        failure: "invalid_cache_value",
      });
      await cacheRedis.del(cacheKey).catch(() => undefined);
    }
  }

  const client = getCohereClient();
  let response;
  try {
    response = await withRetry(() =>
      client.rerank({
        model: "rerank-english-v3.0",
        query,
        documents: chunks.map((c) => ({ text: c.text })),
        topN: resolvedTopK,
      })
    );
  } catch {
    logger.error("rerankChunks: Cohere rerank failed after retries", {
      chunk_count: chunks.length,
      failure: "provider_error",
    });
    // Provider errors can include request or response bodies. Keep the caller-
    // visible error stable and payload-free so upstream logs cannot leak them.
    throw new Error("rerankChunks: Cohere request failed");
  }

  const parsedResponse = CohereResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    logger.error("rerankChunks: Cohere returned an invalid response", {
      chunk_count: chunks.length,
      failure: "invalid_provider_response",
    });
    throw new Error("rerankChunks: invalid Cohere rerank response");
  }
  const responseIndexes = parsedResponse.data.results.map((result) => result.index);
  if (
    responseIndexes.some((index) => index >= chunks.length) ||
    new Set(responseIndexes).size !== responseIndexes.length
  ) {
    logger.error("rerankChunks: Cohere returned invalid document indexes", {
      chunk_count: chunks.length,
      failure: "invalid_provider_mapping",
    });
    throw new Error("rerankChunks: invalid Cohere rerank mapping");
  }

  // response.results arrive pre-sorted by relevance descending — don't re-sort.
  // result.index is the position in the `documents` array we sent, not a chunk id.
  const result: RerankedChunk[] = parsedResponse.data.results
    .map((r) => ({ ...chunks[r.index], relevance_score: r.relevanceScore }))
    .filter((c) => c.relevance_score >= minRelevanceScore);

  await cacheRedis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
  return result;
}
