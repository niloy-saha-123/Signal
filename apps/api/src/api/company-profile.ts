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
import express, { Router } from "express";
import { CompanyProfileSchema } from "@signal/shared";
import * as queries from "../db/queries";
import { cacheRedis } from "../lib/redis-client";
import { queues, type QueueName } from "../queues/registry";
import { logger } from "../lib/logger";
import { wrap, fallbackErrorHandler } from "./http";

// The exact key lib/company-context.ts reads (its CACHE_KEY const).
const PROFILE_CACHE_KEY = "company:profile";

export interface CompanyProfileRouterDeps {
  getCompanyProfile: typeof queries.getCompanyProfile;
  upsertCompanyProfile: typeof queries.upsertCompanyProfile;
  invalidateProfileCache: () => Promise<unknown>;
  enqueue: (queue: QueueName, data: unknown) => Promise<unknown>;
}

export const defaultCompanyProfileRouterDeps: CompanyProfileRouterDeps = {
  getCompanyProfile: queries.getCompanyProfile,
  upsertCompanyProfile: queries.upsertCompanyProfile,
  invalidateProfileCache: () => cacheRedis.del(PROFILE_CACHE_KEY),
  enqueue: (queue, data) => queues[queue].add(queue, data),
};

const BodySchema = CompanyProfileSchema.strict();

export function createCompanyProfileRouter(
  deps: CompanyProfileRouterDeps = defaultCompanyProfileRouterDeps
): Router {
  const router = express.Router();
  router.use(express.json());

  router.get(
    "/",
    wrap(async (_req, res) => {
      const row = await deps.getCompanyProfile();
      if (!row) {
        res
          .status(404)
          .json({ message: "No company profile configured. POST to create one." });
        return;
      }
      res.status(200).json(row);
    })
  );

  router.post(
    "/",
    wrap(async (req, res) => {
      const parsed = BodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }

      const saved = await deps.upsertCompanyProfile(parsed.data);

      // The write succeeded. A stale cache self-heals on TTL and the update
      // queue is documented no-retry, so neither failure fails the request.
      try {
        await deps.invalidateProfileCache();
      } catch (err) {
        logger.warn("Failed to invalidate company:profile cache", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        await deps.enqueue("company-profile-update", {});
      } catch (err) {
        logger.warn("Failed to enqueue company-profile-update", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      res.status(200).json(saved);
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
