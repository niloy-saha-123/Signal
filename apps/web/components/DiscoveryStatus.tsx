// TODO: implement
// Displays CompetitorDiscoveryAgent's progress for a newly added competitor.
// Polls GET /api/competitors/:id/discovery every 3s until discovery_status
// is 'complete' or 'failed', then stops polling. Renders one line per field
// from the returned competitor_discovery_log rows — e.g. "Subreddits ✓",
// "Pricing URL ✓", "RSS feed ✗ (not found — enter manually)" — with a manual
// entry affordance next to any 'not_found' or 'error' row.
export {};
