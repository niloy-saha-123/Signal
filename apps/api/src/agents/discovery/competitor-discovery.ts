// CompetitorDiscoveryAgent — no LLM. Runs once when a competitor is created,
// never on a schedule. Given only `name` and `domain`, discovers subreddits,
// job board tokens, pricing URL, and RSS/changelog feed via pure HTTP
// pattern-matching and fallback probing — no model call required for any
// of it. Triggered by POST /api/competitors, which enqueues this onto the
// 'competitor-discovery' BullMQ queue (see queues/registry.ts) with
// { competitor_id, name, domain } as the job payload.
//
// Discovery strategies per field:
//
//   SUBREDDITS
//     1. GET reddit /search.json?q={name}&type=sr — subreddits named after the company
//     2. GET reddit /search.json?q={name} — mentions across all subreddits, to find
//        where people actually talk about this company (not just its own subreddit)
//     3. Rank candidates from both by mention count, take top 5
//     4. Always include r/SaaS and r/startups as defaults, even if 5 more are found
//
//   GREENHOUSE
//     1. Try boards-api.greenhouse.io/v1/boards/{domain-slug}/jobs
//     2. Try boards-api.greenhouse.io/v1/boards/{name-slug}/jobs
//     3. Try common slug variations (strip .com/.io, strip hyphens)
//     4. A 200 response with a non-empty `jobs` array means that token is real
//
//   LEVER
//     1. Try api.lever.co/v0/postings/{domain-slug}
//     2. Try api.lever.co/v0/postings/{name-slug}
//     3. Same slug-variation pattern as Greenhouse
//
//   PRICING URL
//     1. HEAD request against /pricing, /plans, /price, /pricing-plans, /en/pricing,
//        /en/plans on the domain, in order — first 200 wins
//     2. Fallback: web search "{name} pricing", take the first result whose host
//        matches the competitor's domain
//
//   RSS / CHANGELOG
//     1. Try /blog/rss, /blog/feed, /changelog/rss, /changelog/feed, /feed.xml,
//        /feed, /rss.xml, /rss, /atom.xml on the domain, in order
//     2. Fetch the homepage HTML and parse for
//        <link rel="alternate" type="application/rss+xml">
//     3. First candidate that parses as valid RSS/Atom XML wins
//
// Every attempt (URL tried, outcome) is written as one competitor_discovery_log
// row per field — a 'failed' discovery is diagnosable and manually fixable from
// that log, not a silent gap. On completion, the agent updates the competitors
// row with whatever it found, sets discovery_status = 'complete' (or 'failed'
// if every field came up empty), and stamps discovered_at.
//
// Output shape: CompetitorDiscoveryResult — discovered field values plus one
// DiscoveryLog entry (packages/shared/src/signals.ts) per field attempted.
export {};
