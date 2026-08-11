// Queries agent_latencies and outputs a formatted latency budget report.
//
// For each agent: P50, P95, P99, mean, sample count (via lib/latency-tracker.ts computePercentiles).
// Also shows cost per competitor per day (from llm_costs) and failure rate per agent (from
// agent_runs).
//
// Output formats:
//   --format=table  (default, markdown table to stdout)
//   --format=json   (for programmatic use)
//
// Usage: npm run latency-report
//
// The README's Latency Budget table is generated from this script's output — run it and copy
// the result in.
export {};
