// Latency tracker — records per-agent timing for every analysis graph run and every ChatAgent request.
//
// Usage: wrap any agent execution with trackLatency(agentName, competitorId, runId, fn). The
// wrapper records start time, calls fn(), records end time, computes duration_ms, and writes a row
// to the agent_latencies table (see db/schema.ts).
//
// Also exports computePercentiles(agentName, days), which queries agent_latencies and returns
// { p50, p95, p99, mean, sample_count } for a given agent over the last N days. Percentile
// computation uses the nearest-rank method on sorted duration_ms values.
//
// This data populates the latency budget table shown in the README (generated via
// scripts/latency-report.ts) — measured values, not estimates.
export {};
