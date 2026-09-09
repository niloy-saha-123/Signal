// Hybrid retrieval — combines BM25 keyword search (flexsearch) and semantic vector search
// (Pinecone) via Reciprocal Rank Fusion (RRF). Read side of the index Part 7's deduplicator
// writes (pipeline/deduplicator.ts: pineconeUpsert keyed by signal.id). Standalone, fully
// synchronous library function — no queue/worker involvement.
//
// BM25 side: index is rebuilt in-memory from getRecentSignalsByCompetitorIds on every call.
// No caching — that's flagged as future work (Redis-backed index), not this function's scope.
//
// Merge: RRF, rrf_score = sum(1 / (60 + rank)) across whichever list(s) an id appears in.
// RRF is model-agnostic and outperforms score averaging when combining heterogeneous ranking
// signals (BM25 has no comparable scale to cosine similarity — flexsearch.search doesn't even
// return scores, only rank order, which is all RRF needs).
import { Index } from "flexsearch";
import type { SignalSource } from "@signal/shared";
import { embedText } from "../lib/embeddings";
import { logger } from "../lib/logger";
import { pineconeQuery } from "../vector/pinecone";
import { buildEmbeddingText } from "../pipeline/deduplicator";
import { getRecentSignalsByCompetitorIds, getSignalsByIds, type Signal } from "../db/queries";

export interface RetrievedChunk {
  id: string; // signal.id, same id Pinecone was upserted under
  competitor_id: string;
  source: SignalSource;
  source_url: string | null;
  text: string; // same title+raw_text concatenation as the embedded text
  quality_score: number;
  origin: "bm25" | "semantic" | "both";
  rrf_score: number;
}

const RRF_K = 60;

// Pinecone has no quality_score in its metadata (deduplicator's upsert only writes
// { source }) — a Pinecone filter on it would silently match nothing. Apply the floor in
// application code, after hydrating each matched id's real row from Postgres. Drop, don't
// clamp. No env var exists for this (checked .env.example) — a documented local constant.
export const MIN_QUALITY_SCORE_FOR_RETRIEVAL = 0.15;

export async function hybridRetrieve(
  query: string,
  competitorIds: string[],
  topK: number = Number(process.env.HYBRID_RETRIEVAL_TOP_K) || 20
): Promise<RetrievedChunk[]> {
  if (competitorIds.length === 0) {
    return [];
  }

  const queryEmbedding = await embedText(query);

  // Semantic side: one query per competitor namespace (pineconeQuery is single-namespace,
  // competitorId is mandatory), flattened and re-ranked by score across the whole fan-out.
  // allSettled, not all — pineconeQuery already retries internally (lib/retry.ts), so a
  // rejection here means a persistent per-competitor failure. Isolate it: skip that
  // competitor's semantic results and continue with the rest rather than failing the
  // whole multi-competitor call. BM25 results (and other competitors' semantic results)
  // still come back even if every competitor fails here.
  // Neither side depends on the other's result — the semantic fan-out only needs
  // queryEmbedding/competitorIds, the BM25 corpus fetch only needs competitorIds. Run them
  // concurrently instead of adding a full Postgres round-trip to this latency-sensitive path.
  const [semanticSettled, corpus] = await Promise.all([
    Promise.allSettled(
      competitorIds.map((competitorId) => pineconeQuery(competitorId, queryEmbedding, topK))
    ),
    getRecentSignalsByCompetitorIds(competitorIds),
  ]);
  const semanticMatches = semanticSettled.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    logger.warn("hybridRetrieve: pineconeQuery failed for competitor — skipping", {
      competitor_id: competitorIds[index],
      error: result.reason,
    });
    return [];
  });
  semanticMatches.sort((a, b) => b.score - a.score);

  const semanticRanks = new Map<string, number>();
  semanticMatches.forEach((match, index) => {
    if (!semanticRanks.has(match.id)) {
      semanticRanks.set(match.id, index + 1);
    }
  });

  // BM25 side: fresh in-memory index every call (documented tradeoff above — no caching).
  const corpusById = new Map(corpus.map((signal) => [signal.id, signal]));

  const bm25Index = new Index();
  for (const signal of corpus) {
    bm25Index.add(signal.id, buildEmbeddingText(signal));
  }
  const bm25Results = bm25Index.search(query, { limit: topK });

  const bm25Ranks = new Map<string, number>();
  bm25Results.forEach((id, index) => {
    bm25Ranks.set(String(id), index + 1);
  });

  // RRF merge over the union of both lists.
  const allIds = new Set([...semanticRanks.keys(), ...bm25Ranks.keys()]);
  const merged: { id: string; origin: RetrievedChunk["origin"]; rrf_score: number }[] = [];
  for (const id of allIds) {
    const semanticRank = semanticRanks.get(id);
    const bm25Rank = bm25Ranks.get(id);
    const rrf_score =
      (semanticRank !== undefined ? 1 / (RRF_K + semanticRank) : 0) +
      (bm25Rank !== undefined ? 1 / (RRF_K + bm25Rank) : 0);
    const origin: RetrievedChunk["origin"] =
      semanticRank !== undefined && bm25Rank !== undefined
        ? "both"
        : semanticRank !== undefined
          ? "semantic"
          : "bm25";
    merged.push({ id, origin, rrf_score });
  }

  // Hydrate: bm25-side ids already have their row from the corpus fetch above — only
  // semantic-only ids need a bulk lookup.
  const missingIds = merged.filter((m) => !corpusById.has(m.id)).map((m) => m.id);
  if (missingIds.length > 0) {
    const hydrated = await getSignalsByIds(missingIds);
    for (const signal of hydrated) {
      corpusById.set(signal.id, signal);
    }
  }

  const chunks: RetrievedChunk[] = [];
  for (const m of merged) {
    const signal: Signal | undefined = corpusById.get(m.id);
    // A matched id with no corresponding db row (deleted signal, stale vector) — skip
    // rather than throw, same defensive pattern as deduplicator's matched-id lookup.
    if (!signal) continue;
    if (signal.quality_score < MIN_QUALITY_SCORE_FOR_RETRIEVAL) continue;

    chunks.push({
      id: signal.id,
      competitor_id: signal.competitor_id,
      source: signal.source,
      source_url: signal.source_url,
      text: buildEmbeddingText(signal),
      quality_score: signal.quality_score,
      origin: m.origin,
      rrf_score: m.rrf_score,
    });
  }

  chunks.sort((a, b) => b.rrf_score - a.rrf_score);
  return chunks.slice(0, topK);
}
