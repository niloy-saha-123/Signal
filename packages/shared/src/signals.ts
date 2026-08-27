// Zod schemas for the Signal record, SignalCluster (deduplication), and SignalScore (0-100 composite
// threat score per competitor: mention velocity, sentiment trajectory, hiring momentum, pricing
// change recency, vulnerability window status) shapes.
// TODO: Signal / SignalCluster / SignalScore schemas — still stubs.

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
