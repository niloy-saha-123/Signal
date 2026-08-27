// Defines all BullMQ Queue and Worker instances for the 5 collectors, 3 pipeline stages, and analysis queue.
//
// Queue: competitor-discovery
//   Purpose: runs CompetitorDiscoveryAgent for a newly added competitor.
//   Triggered by: POST /api/competitors
//   Concurrency: 3 — safe to discover several competitors at once, each job
//     only makes independent outbound HTTP calls, no shared state to race on.
//   Retry: 2 attempts, 5s delay — network failures should retry; a
//     persistent failure is logged to competitor_discovery_log and the
//     competitor's discovery_status is set to 'failed' rather than retried forever.
//   No rate limiting — discovery runs once per competitor, not on a
//     recurring schedule, so there's no sustained request volume to cap.
//
// Queue: company-profile-update
//   Purpose: when the company profile changes, re-run any pending analyses
//     so their output reflects the new product/ICP/pricing context.
//   Triggered by: POST /api/company-profile
//   Concurrency: 1 — this is a low-frequency, low-volume signal; no need
//     to parallelize.
//   No retry — a missed re-run just means agents use slightly stale
//     context until the next scheduled analysis, not a correctness bug.
export {};
