// Real-time RAG chat agent — streams Claude Sonnet responses over quality-weighted Pinecone retrieval (SSE).
//
// ChatAgent now uses a three-stage retrieval pipeline:
//   1. hybridRetrieve() — BM25 + semantic, RRF merged
//   2. rerankChunks() — Cohere reranker rescore
//   3. enforceCitations() — claim validation + refusal
// Refusal is a first-class output: if retrieved evidence does not support the query, the agent
// returns a RefusalResult rather than a low-quality answer. P50/P95 latency is tracked via
// latency-tracker.ts on every request.
export {};
