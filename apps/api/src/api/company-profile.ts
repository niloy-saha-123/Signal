// Express routes for the single-row company_profile table.
//
// GET /api/company-profile
//   Returns the current company profile row. If none exists yet, return 404
//   with { message: "No company profile configured. POST to create one." }
//
// POST /api/company-profile
//   Creates or updates (upsert — single-row table, no id in the request)
//   the company profile. Validates the body with CompanyProfileSchema
//   (packages/shared/src/signals.ts). On success, enqueue a
//   'company-profile-update' BullMQ job (see queues/registry.ts) so any
//   pending analysis picks up the new context, and invalidate the
//   'company:profile' Redis cache key that lib/company-context.ts reads.
//   Returns 200 with the saved profile.
export {};
