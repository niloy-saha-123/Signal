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
// Cost: the Cohere reranker free tier is 1000 calls/month. Reranker results should be cached in
// Redis at a 2h TTL for identical (query, chunk_ids) pairs to reduce cost under repeat queries.
//
// Exported function: rerankChunks(query, chunks, topK)
export {};
