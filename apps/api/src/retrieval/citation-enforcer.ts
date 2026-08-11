// Citation enforcer — validates that a ChatAgent response is grounded in retrieved chunks.
// Used by: ChatAgent (stage 3 of its three-stage retrieval pipeline), after rerankChunks().
// Prevents hallucination from reaching the user.
//
// Pipeline:
//   1. Extract all claims from the generated response (GPT-4o-mini with a strict extraction prompt).
//   2. For each claim, check whether it is supported by at least one retrieved chunk
//      (semantic similarity threshold: 0.75, see CITATION_ENFORCEMENT_THRESHOLD in .env.example).
//   3. If unsupported claims exist:
//        Option A (low severity) — append a caveat: "Note: some details could not be verified
//          against stored signals."
//        Option B (high severity, > 40% of claims unsupported) — refuse to return the response
//          entirely and return a structured refusal object instead.
//   4. Attach citation metadata to each supported claim: { claim, chunk_id, source, similarity_score }.
//
// Refusal object schema (Zod validated): { refused: true, reason: string, suggested_query: string }
//
// Exported function: enforceCitations(response, chunks, query) -> CitationResult | RefusalResult
// CitationResult / RefusalResult types live in packages/shared/src/agents.ts.
export {};
