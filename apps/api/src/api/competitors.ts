// Express routes for competitor CRUD and triggering manual analysis runs.
// GET /competitors/:id/score — current Signal Score, component breakdown, and 7d/30d delta.
//
// POST /competitors
//   1. Validate body with CompetitorCreateInput (name + domain required,
//      subreddits/greenhouse_token/lever_token/pricing_url/rss_url optional —
//      pass any of them to skip discovery for that specific field)
//   2. Insert the competitors row with discovery_status = 'pending'
//   3. Enqueue a 'competitor-discovery' BullMQ job:
//      { competitor_id, name, domain }
//   4. Return 201 with the created row, including discovery_status: 'pending'
//      so the frontend can render a "discovering..." state immediately
//
// GET /competitors/:id/discovery
//   Returns the competitor_discovery_log rows for this competitor id
//   (ordered by discovered_at) — one row per field CompetitorDiscoveryAgent
//   attempted, with what it tried and what it found. Polled by
//   DiscoveryStatus.tsx every 3s while discovery_status is pending/in_progress.
export {};
