// LangGraph node — SQL volume aggregation plus GPT-4o trend synthesis over Pinecone signals.
// Phase 2 (after 90 days of accumulation): retrieves historically similar signal patterns for this
// competitor from Pinecone and weights current predictions by what happened after past occurrences.
//
// Phase 2 retrieval now uses hybridRetrieve() (BM25 + semantic) instead of semantic-only Pinecone
// query. This improves recall for specific terms (competitor names, exact pricing figures, product
// feature names) that vector search sometimes misses. Results are NOT reranked — PatternDetector
// processes all 150 chunks, and reranking would discard potentially relevant trend signals.
// P50/P95 tracked via latency-tracker.ts.
export {};
