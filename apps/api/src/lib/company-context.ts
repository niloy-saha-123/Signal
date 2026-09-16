// Fetches the company profile and formats it into a system-prompt injection
// string used by every analysis agent, so output is judged against this
// company's actual product/ICP/pricing instead of producing generic
// competitor commentary.
//
// Usage in agent system prompts:
//   const context = await getCompanyContext(state.workspace_id)
//   const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${context}`
//
// Injected format:
//   "ABOUT THE USER'S COMPANY:
//    Product: {product_description}
//    Target customers: {icp_buyer_role} at {icp_company_size} companies
//      in {icp_industries}
//    Pricing: {formatted pricing tiers}
//    Key strengths vs competitors: {key_differentiators}
//
//    When analyzing competitor signals, always interpret them in the
//    context of this company's positioning, pricing, and target customers.
//    Make recommendations specific to this company, not generic advice."
//
// Cached in Redis per-workspace at key 'company:profile:{workspaceId}', 1h TTL
// — the profile changes rarely (only via POST /api/company-profile, which
// invalidates this key), so there's no reason to hit PostgreSQL on every
// agent call.
//
// Exports: getCompanyContext(workspaceId: string): Promise<string>
//   If no company_profile row exists for that workspace, returns "" —
//   agents must work without it and just produce generic output, not throw.
// Exports: invalidateCompanyContextCache(workspaceId: string): Promise<unknown>
//   Deletes that workspace's cache entry — called by POST /api/company-profile
//   and the company-profile-update worker after a profile write.

import { getCompanyProfileForWorkspace } from "../db/queries";
import { cacheRedis } from "./redis-client";

const CACHE_TTL_SECONDS = 3600;

function cacheKey(workspaceId: string): string {
  return `company:profile:${workspaceId}`;
}

export async function getCompanyContext(workspaceId: string): Promise<string> {
  const key = cacheKey(workspaceId);
  const cached = await cacheRedis.get(key);
  if (cached) return cached;

  const profile = await getCompanyProfileForWorkspace(workspaceId);
  if (!profile) return "";

  const pricingLines = (profile.pricing_tiers ?? [])
    .map((tier) => {
      const t = tier as { name?: string; price?: number; billing?: string };
      return `  - ${t.name}: $${t.price}/${t.billing}`;
    })
    .join("\n");

  const context = [
    "ABOUT THE USER'S COMPANY:",
    `Product: ${profile.product_description}`,
    `Target customers: ${profile.icp_buyer_role ?? "unspecified"} at ${
      profile.icp_company_size ?? "unspecified"
    } companies in ${(profile.icp_industries ?? []).join(", ") || "unspecified industries"}`,
    "Pricing:",
    pricingLines || "  (not specified)",
    `Key strengths vs competitors: ${(profile.key_differentiators ?? []).join(", ")}`,
    "",
    "When analyzing competitor signals, always interpret them in the context of this",
    "company's positioning, pricing, and target customers. Make recommendations specific",
    "to this company, not generic advice.",
  ].join("\n");

  await cacheRedis.setex(key, CACHE_TTL_SECONDS, context);
  return context;
}

export async function invalidateCompanyContextCache(workspaceId: string): Promise<unknown> {
  return cacheRedis.del(cacheKey(workspaceId));
}
