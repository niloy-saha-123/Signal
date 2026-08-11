// Offline evaluation script for ChatAgent RAG quality.
//
// Loads all rows from rag_eval_dataset. For each question:
//   1. Runs the full ChatAgent retrieval pipeline (hybridRetrieve -> rerank -> generate).
//   2. Scores faithfulness using GPT-4o-mini as judge: prompt asks "is this answer grounded in
//      these chunks? score 0.0-1.0 with reasoning."
//   3. Stores the result in rag_eval_runs.
//
// Aggregates faithfulness across all questions. Exit code 1 if aggregate faithfulness is below
// threshold (default: 0.75, configurable via --threshold, see RAG_EVAL_FAITHFULNESS_THRESHOLD in
// .env.example). Exit code 0 if passing.
//
// Used in GitHub Actions CI (.github/workflows/ci.yml, job: rag-eval) — if this script fails, the
// build fails.
//
// Usage:
//   npm run rag-eval
//   npm run rag-eval -- --threshold=0.80
//   npm run rag-eval -- --competitor-id={id}
export {};
