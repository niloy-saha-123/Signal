// Fetches the company profile and formats it into a system-prompt injection
// string used by every analysis agent, so output is judged against this
// company's actual product/ICP/pricing instead of producing generic
// competitor commentary.
//
// Usage in agent system prompts:
//   const context = await getCompanyContext()
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
// Cached in Redis at key 'company:profile', 1h TTL — the profile changes
// rarely (only via POST /api/company-profile, which invalidates this key),
// so there's no reason to hit PostgreSQL on every agent call.
//
// Exports: getCompanyContext(): Promise<string>
//   If no company_profile row exists, returns "" — agents must work
//   without it and just produce generic output, not throw.
export {};
