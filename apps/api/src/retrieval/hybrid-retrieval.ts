// Hybrid retrieval — combines BM25 keyword search (flexsearch) and semantic vector search (Pinecone).
// Used by: ChatAgent (stage 1 of its three-stage retrieval pipeline) and PatternDetector Phase 2.
//
// BM25 side: indexes are built in-memory from recently retrieved signal chunks for a given
// competitor namespace, and rebuilt on each query. Acceptable at current scale — flagged for
// Redis-backed index caching once query volume or chunk count makes per-query rebuild too slow.
//
// Semantic side: queries Pinecone with the embedded query vector, filtered by competitor_id
// namespace and a minimum quality_score in metadata (same weighting scheme used elsewhere —
// see vector/pinecone.ts).
//
// Merge: results from both sources are combined with Reciprocal Rank Fusion (RRF):
//   score = sum(1 / (k + rank_i))  where k = 60
// RRF is model-agnostic and outperforms simple score averaging when combining heterogeneous
// ranking signals (BM25 scores and cosine similarities live on incompatible scales).
//
// Output: a deduplicated, RRF-ranked list of chunks with source metadata tagging each chunk as
// bm25 | semantic | both.
//
// Exported function: hybridRetrieve(query, competitorIds, topK)
export {};
