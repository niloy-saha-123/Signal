// Company profile settings page — the one-time setup that lets every
// analysis agent produce recommendations specific to this company instead
// of generic competitor commentary (see lib/company-context.ts on the API side).
//
// Form fields, matching CompanyProfileSchema (packages/shared/src/signals.ts):
//   Product description   — textarea
//   ICP company size      — text (e.g. "10-200 employees")
//   ICP industries        — tag input
//   ICP buyer role        — text (e.g. "Head of Product")
//   Pricing tiers         — dynamic form, add/remove { name, price, billing }
//   Key differentiators   — tag input, max 3
//   Primary competitors   — multi-select, sourced from the monitored competitor list
//
// On save: POST /api/company-profile.
// If no profile exists yet (GET returns 404), show a banner: "Complete your
// company profile to get personalized intelligence instead of generic analysis."
export default function Page() {
  return null;
}
