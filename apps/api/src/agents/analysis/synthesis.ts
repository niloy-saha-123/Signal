// LangGraph node — combines all agent outputs into an alert/digest/suppress decision (Claude Sonnet).
// Also computes each competitor's Signal Score (0-100) daily: mention velocity, sentiment trajectory,
// hiring momentum, pricing change recency, and vulnerability window status.
//
// Signal Score computation happens here. Score components are stored as JSONB in
// competitor_signal_scores alongside the composite score. Latency of this node is tracked via
// latency-tracker.ts.
export {};
