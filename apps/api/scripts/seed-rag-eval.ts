// Seeds the rag_eval_dataset table with an initial set of 50 manually verified question/answer pairs.
//
// Questions cover five categories: pricing_history, hiring_pattern, product_change,
// sentiment_theme, strategic_move. Each is answered using real historical data from the
// backfilled competitor signals — the expected_answer field holds the ground-truth answer a human
// verified against primary sources.
//
// Run once after backfill: npm run seed-rag-eval
//
// Do NOT regenerate these automatically — the golden dataset is manually curated. Adding new cases
// is a deliberate human decision, not something this script (or any automated process) should do
// on its own.
export {};
