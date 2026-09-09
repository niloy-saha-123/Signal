// Home screen — competitor list with Signal Score per competitor, 30-day sparkline, and last alert timestamp.
//
// Add Competitor form asks for only two fields: name (text) and domain
// (text, e.g. "notion.so"). On submit, POST /api/competitors, then render
// <DiscoveryStatus /> for that competitor — a "Discovering..." state while
// CompetitorDiscoveryAgent runs in the background. When discovery_status
// flips to 'complete', show what was found (subreddits, pricing URL, RSS
// feed, job board token). When 'failed', show what failed with a manual
// entry option for the missing fields.
export default function Page() {
  return null;
}
