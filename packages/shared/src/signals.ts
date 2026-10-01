// Zod schemas for the Signal record, SignalCluster (deduplication), and SignalScore (0-100 composite
// threat score per competitor: mention velocity, sentiment trajectory, hiring momentum, pricing
// change recency, vulnerability window status) shapes.

import { z } from "zod";

// Company's own product/ICP/pricing context. Powers lib/company-context.ts's
// getCompanyContext(), injected into every analysis agent's system prompt so
// output is judged against this company's actual positioning, not generic.
export const CompanyProfileSchema = z.object({
  product_description: z.string().trim().min(1).max(10_000),
  icp_company_size: z.string().trim().min(1).max(500).optional(),
  icp_industries: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  icp_buyer_role: z.string().trim().min(1).max(500).optional(),
  pricing_tiers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        price: z.number().finite().nonnegative().max(1_000_000_000),
        billing: z.enum(["monthly", "annual", "custom"]),
      })
    )
    .max(50)
    .default([]),
  key_differentiators: z
    .array(z.string().trim().min(1).max(1_000))
    .max(50)
    .default([]),
  primary_competitor_ids: z.array(z.string().uuid()).max(50).default([]),
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

// POST /api/competitors body. Only name + domain are required — everything
// else is filled in asynchronously by CompetitorDiscoveryAgent, but callers
// may still supply a field directly to skip discovery for that one field.
// z.string().url() accepts any parseable scheme (javascript:, file:, data:).
// These URLs are fetched by collectors, so only the web is allowed in.
const webUrl = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => /^https?:\/\//i.test(value), "must be an http(s) URL");

const NPM_PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PYPI_PROJECT_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;

// Config for the v5 sources. Package names end up in registry URLs, so they are
// held to each registry's own naming rules rather than "any string".
const sourceConfigFields = {
  news_query: z.string().trim().min(1).max(200),
  docs_sitemap_url: webUrl,
  npm_packages: z
    .array(z.string().max(214).regex(NPM_PACKAGE_NAME, "must be an npm package name"))
    .max(10),
  pypi_packages: z
    .array(z.string().max(100).regex(PYPI_PROJECT_NAME, "must be a PyPI project name"))
    .max(10),
  blog_feeds: z.array(webUrl).max(10),
  social_feeds: z.array(webUrl).max(10),
  forum_feeds: z.array(webUrl).max(10),
  bluesky_handle: z
    .string()
    .trim()
    .max(253)
    .regex(/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/, "must be a Bluesky handle"),
  stackoverflow_tag: z.string().trim().regex(/^[a-z0-9][a-z0-9.#+-]{0,34}$/, "must be a Stack Overflow tag"),
};

export const CompetitorCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(253),
  subreddits: z.array(z.string().trim().min(1).max(100)).max(25).optional(),
  greenhouse_token: z.string().trim().min(1).max(200).optional(),
  lever_token: z.string().trim().min(1).max(200).optional(),
  pricing_url: webUrl.optional(),
  rss_url: webUrl.optional(),
  // A GitHub org/user login, not a URL — GitHub's own limit is 39 characters of
  // alphanumerics and single hyphens.
  github_org: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, "must be a GitHub org or user login")
    .optional(),
  website_urls: z.array(webUrl).max(10).optional(),
  discourse_url: webUrl.optional(),
  postings_rss: webUrl.optional(),
  news_query: sourceConfigFields.news_query.optional(),
  docs_sitemap_url: sourceConfigFields.docs_sitemap_url.optional(),
  npm_packages: sourceConfigFields.npm_packages.optional(),
  pypi_packages: sourceConfigFields.pypi_packages.optional(),
  blog_feeds: sourceConfigFields.blog_feeds.optional(),
  social_feeds: sourceConfigFields.social_feeds.optional(),
  forum_feeds: sourceConfigFields.forum_feeds.optional(),
  bluesky_handle: sourceConfigFields.bluesky_handle.optional(),
  stackoverflow_tag: sourceConfigFields.stackoverflow_tag.optional(),
});
export type CompetitorCreateInput = z.infer<typeof CompetitorCreateInputSchema>;

// PATCH /api/competitors/:id body — only the v5 source config. null / [] clears.
export const CompetitorSourceConfigSchema = z
  .object({
    news_query: sourceConfigFields.news_query.nullable().optional(),
    docs_sitemap_url: sourceConfigFields.docs_sitemap_url.nullable().optional(),
    npm_packages: sourceConfigFields.npm_packages.optional(),
    pypi_packages: sourceConfigFields.pypi_packages.optional(),
    blog_feeds: sourceConfigFields.blog_feeds.optional(),
    social_feeds: sourceConfigFields.social_feeds.optional(),
    forum_feeds: sourceConfigFields.forum_feeds.optional(),
    bluesky_handle: sourceConfigFields.bluesky_handle.nullable().optional(),
    stackoverflow_tag: sourceConfigFields.stackoverflow_tag.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "at least one field is required");
export type CompetitorSourceConfig = z.infer<typeof CompetitorSourceConfigSchema>;

// POST /api/competitors/:id/field-intel body.
export const FieldIntelInputSchema = z
  .object({
    note: z.string().trim().min(1).max(4_000),
    url: webUrl.optional(),
  })
  .strict();
export type FieldIntelInput = z.infer<typeof FieldIntelInputSchema>;

// Mirrors competitors.discovery_status's CHECK constraint in db/schema.ts.
export const DiscoveryStatusSchema = z.enum(["pending", "in_progress", "complete", "failed"]);
export type DiscoveryStatus = z.infer<typeof DiscoveryStatusSchema>;

// One row of competitor_discovery_log — what CompetitorDiscoveryAgent tried
// for a single field and what it found (or didn't).
export const DiscoveryLogSchema = z.object({
  field_name: z.enum([
    "subreddits",
    "greenhouse",
    "lever",
    "pricing_url",
    "rss_url",
    "github_org",
    "website_urls",
    "discourse_url",
    "postings_rss",
  ]),
  attempted_urls: z.array(z.string()),
  discovered_value: z.string().nullable(),
  status: z.enum(["found", "not_found", "error"]),
  error_message: z.string().nullable(),
});
export type DiscoveryLog = z.infer<typeof DiscoveryLogSchema>;

// Output of CompetitorDiscoveryAgent (agents/discovery/competitor-discovery.ts) —
// the discovered field values plus one DiscoveryLog per field it attempted.
// A field the agent skipped (already pre-filled on the competitors row) or failed
// to find is null here (subreddits: [] for the array field).
export const CompetitorDiscoveryResultSchema = z.object({
  subreddits: z.array(z.string()),
  greenhouse_token: z.string().nullable(),
  lever_token: z.string().nullable(),
  pricing_url: z.string().nullable(),
  changelog_rss: z.string().nullable(),
  github_org: z.string().nullable(),
  website_urls: z.array(z.string()),
  discourse_url: z.string().nullable(),
  postings_rss: z.string().nullable(),
  logs: z.array(DiscoveryLogSchema),
});
export type CompetitorDiscoveryResult = z.infer<typeof CompetitorDiscoveryResultSchema>;

// One row of the `signals` table (apps/api/src/db/schema.ts) — a single collected
// mention/post/comment/pricing-page-diff before or after clustering.
export const SignalSourceSchema = z.enum([
  "reddit",
  "hn",
  "jobs",
  "changelog",
  "pricing",
  "github",
  // The competitor's own marketing site — homepage, product and docs pages —
  // watched for meaningful copy changes. Positioning shifts show up here before
  // anyone writes a post about them.
  "website",
  // Public community platforms the competitor runs: Discourse forums and GitHub
  // Discussions. Distinct from `reddit`, which is a third-party venue; a
  // company's own forum carries support load and roadmap complaints it cannot
  // moderate away.
  "community",
  // Public company postings — newsroom, press and announcement feeds that are
  // not the engineering changelog.
  "postings",
  // Press coverage from Google News — edited third-party reporting.
  "news",
  // Pages newly added to the competitor's docs sitemap.
  "docs",
  // New npm / PyPI releases of the competitor's own packages.
  "packages",
  // Links and notes submitted by the user's own teammates.
  "field",
  // The competitor's own blog and publication feeds (Medium, Hashnode, Dev.to).
  "blog",
  // The competitor's own social accounts: YouTube, Mastodon, Bluesky.
  "social",
]);
export type SignalSource = z.infer<typeof SignalSourceSchema>;

export const SignalSchema = z.object({
  id: z.string().uuid(),
  competitor_id: z.string().uuid(),
  source: SignalSourceSchema,
  source_url: z.string().url().nullable().optional(),
  title: z.string().nullable().optional(),
  raw_text: z.string(),
  quality_score: z.number().min(0).max(1),
  entities: z.record(z.string(), z.unknown()).nullable().default({}),
  cluster_id: z.string().uuid().nullable().optional(),
  collected_at: z.string().datetime(),
  created_at: z.string().datetime(),
});
export type Signal = z.infer<typeof SignalSchema>;

// pipeline/entity-extractor.ts's structured-output shape — the value stored in
// signals.entities. All three keys are always present; empty arrays (never an
// omitted key) when the LLM finds no matches for a category.
// .describe() text is forwarded verbatim into the LLM's structured-output function
// schema — it's the highest-leverage place to shape the response, so keep it concrete.
export const SignalEntitiesSchema = z
  .object({
    prices: z
      .array(z.string())
      .describe(
        'Every price or dollar amount mentioned, verbatim and with its unit, e.g. "$99/month", "$1,200/year", "$0.02 per request". Empty array if none.'
      ),
    products: z
      .array(z.string())
      .describe(
        'Named products, plans, or SKUs mentioned, e.g. "Widget Pro", "Enterprise tier". Product names only — not the company name itself. Empty array if none.'
      ),
    features: z
      .array(z.string())
      .describe(
        'Named capabilities or features mentioned, e.g. "SSO", "audit logs", "Slack integration". Empty array if none.'
      ),
  })
  .describe(
    "Structured entities extracted from one collected competitor signal. Always return all three keys — use an empty array for a category with no matches, never omit a key."
  );
export type SignalEntities = z.infer<typeof SignalEntitiesSchema>;

// One row of `signal_clusters` — a deduplicated group of Signals describing the
// same underlying event, merged by pipeline/deduplicator.ts at >=0.88 cosine similarity.
export const SignalClusterSchema = z.object({
  id: z.string().uuid(),
  competitor_id: z.string().uuid(),
  canonical_summary: z.string(),
  contributing_sources: z.array(SignalSourceSchema),
  corroboration_count: z.number().int().min(1),
  first_seen_at: z.string().datetime(),
  last_updated: z.string().datetime(),
  created_at: z.string().datetime(),
});
export type SignalCluster = z.infer<typeof SignalClusterSchema>;

// One row of `competitor_signal_scores` — the 0-100 composite threat score, recomputed
// daily by SynthesisAgent from these five weighted components.
export const SignalScoreComponentsSchema = z.object({
  mention_velocity: z.number().finite(),
  sentiment_trajectory: z.number().finite(),
  hiring_momentum: z.number().finite(),
  pricing_change_recency: z.number().finite(),
  vulnerability_window_status: z.enum(["open", "closed", "none"]),
});
export type SignalScoreComponents = z.infer<typeof SignalScoreComponentsSchema>;

export const SignalScoreSchema = z.object({
  id: z.string().uuid(),
  competitor_id: z.string().uuid(),
  score: z.number().int().min(0).max(100),
  components: SignalScoreComponentsSchema,
  delta_7d: z.number().finite().nullable().optional(),
  delta_30d: z.number().finite().nullable().optional(),
  computed_at: z.string().datetime(),
});
export type SignalScore = z.infer<typeof SignalScoreSchema>;
