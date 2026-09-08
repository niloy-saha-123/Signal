// Zod schemas for the Signal record, SignalCluster (deduplication), and SignalScore (0-100 composite
// threat score per competitor: mention velocity, sentiment trajectory, hiring momentum, pricing
// change recency, vulnerability window status) shapes.

import { z } from "zod";

// Company's own product/ICP/pricing context. Powers lib/company-context.ts's
// getCompanyContext(), injected into every analysis agent's system prompt so
// output is judged against this company's actual positioning, not generic.
export const CompanyProfileSchema = z.object({
  product_description: z.string(),
  icp_company_size: z.string().optional(),
  icp_industries: z.array(z.string()).default([]),
  icp_buyer_role: z.string().optional(),
  pricing_tiers: z
    .array(
      z.object({
        name: z.string(),
        price: z.number(),
        billing: z.enum(["monthly", "annual", "custom"]),
      })
    )
    .default([]),
  key_differentiators: z.array(z.string()).default([]),
  primary_competitor_ids: z.array(z.string().uuid()).default([]),
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

// POST /api/competitors body. Only name + domain are required — everything
// else is filled in asynchronously by CompetitorDiscoveryAgent, but callers
// may still supply a field directly to skip discovery for that one field.
export const CompetitorCreateInputSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  subreddits: z.array(z.string()).optional(),
  greenhouse_token: z.string().optional(),
  lever_token: z.string().optional(),
  pricing_url: z.string().url().optional(),
  rss_url: z.string().url().optional(),
});
export type CompetitorCreateInput = z.infer<typeof CompetitorCreateInputSchema>;

// Mirrors competitors.discovery_status's CHECK constraint in db/schema.ts.
export const DiscoveryStatusSchema = z.enum(["pending", "in_progress", "complete", "failed"]);
export type DiscoveryStatus = z.infer<typeof DiscoveryStatusSchema>;

// One row of competitor_discovery_log — what CompetitorDiscoveryAgent tried
// for a single field and what it found (or didn't).
export const DiscoveryLogSchema = z.object({
  field_name: z.enum(["subreddits", "greenhouse", "lever", "pricing_url", "rss_url"]),
  attempted_urls: z.array(z.string()),
  discovered_value: z.string().nullable(),
  status: z.enum(["found", "not_found", "error"]),
  error_message: z.string().nullable(),
});
export type DiscoveryLog = z.infer<typeof DiscoveryLogSchema>;

// One row of the `signals` table (apps/api/src/db/schema.ts) — a single collected
// mention/post/comment/pricing-page-diff before or after clustering.
export const SignalSourceSchema = z.enum(["reddit", "hn", "jobs", "changelog", "pricing"]);
export type SignalSource = z.infer<typeof SignalSourceSchema>;

export const SignalSchema = z.object({
  id: z.string().uuid(),
  competitor_id: z.string().uuid(),
  source: SignalSourceSchema,
  source_url: z.string().url().nullable().optional(),
  title: z.string().nullable().optional(),
  raw_text: z.string(),
  quality_score: z.number().min(0).max(1),
  entities: z.record(z.string(), z.unknown()).default({}),
  cluster_id: z.string().uuid().nullable().optional(),
  collected_at: z.string().datetime(),
  created_at: z.string().datetime(),
});
export type Signal = z.infer<typeof SignalSchema>;

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
  mention_velocity: z.number(),
  sentiment_trajectory: z.number(),
  hiring_momentum: z.number(),
  pricing_change_recency: z.number(),
  vulnerability_window_status: z.enum(["open", "closed", "none"]),
});
export type SignalScoreComponents = z.infer<typeof SignalScoreComponentsSchema>;

export const SignalScoreSchema = z.object({
  id: z.string().uuid(),
  competitor_id: z.string().uuid(),
  score: z.number().int().min(0).max(100),
  components: SignalScoreComponentsSchema,
  delta_7d: z.number().nullable().optional(),
  delta_30d: z.number().nullable().optional(),
  computed_at: z.string().datetime(),
});
export type SignalScore = z.infer<typeof SignalScoreSchema>;
