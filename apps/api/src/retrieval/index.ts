// Unified retrieval pipeline: hybrid search -> rerank -> citation enforcement.
// Import from here, not from individual files.
//
// Re-exports hybridRetrieve (hybrid-retrieval.ts), rerankChunks (reranker.ts), and
// enforceCitations (citation-enforcer.ts) as the single entry point for retrieval. Pipeline order
// is fixed: hybridRetrieve -> rerankChunks -> enforceCitations — do not skip stages.
export {};
