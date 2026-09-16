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
//   pending analysis picks up the new context, and invalidate this
//   workspace's Redis cache entry that lib/company-context.ts reads.
//   Returns 200 with the saved profile.
import express, { Router } from "express";
import { CompanyProfileSchema } from "@signal/shared";
import * as queries from "../db/queries";
import { invalidateCompanyContextCache } from "../lib/company-context";
import { queues, type QueueName } from "../queues/registry";
import { logger } from "../lib/logger";
import { wrap, fallbackErrorHandler } from "./http";

export interface CompanyProfileRouterDeps {
  getCompanyProfileForWorkspace: typeof queries.getCompanyProfileForWorkspace;
  getCompetitorsByIdsForWorkspace: typeof queries.getCompetitorsByIdsForWorkspace;
  upsertCompanyProfileForWorkspace: typeof queries.upsertCompanyProfileForWorkspace;
  invalidateProfileCache: (workspaceId: string) => Promise<unknown>;
  enqueue: (queue: QueueName, data: unknown) => Promise<unknown>;
}

export const defaultCompanyProfileRouterDeps: CompanyProfileRouterDeps = {
  getCompanyProfileForWorkspace: queries.getCompanyProfileForWorkspace,
  getCompetitorsByIdsForWorkspace: queries.getCompetitorsByIdsForWorkspace,
  upsertCompanyProfileForWorkspace: queries.upsertCompanyProfileForWorkspace,
  invalidateProfileCache: invalidateCompanyContextCache,
  enqueue: (queue, data) => queues[queue].add(queue, data),
};

const BodySchema = CompanyProfileSchema.strict();

export function createCompanyProfileRouter(
  deps: CompanyProfileRouterDeps = defaultCompanyProfileRouterDeps
): Router {
  const router = express.Router();
  router.use(express.json());
  router.use((req, res, next) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "no_workspace" });
      return;
    }
    next();
  });

  router.get(
    "/",
    wrap(async (req, res) => {
      const row = await deps.getCompanyProfileForWorkspace(req.workspaceId!);
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

      const primaryIds = [...new Set(parsed.data.primary_competitor_ids)];
      if (primaryIds.length > 0) {
        const found = await deps.getCompetitorsByIdsForWorkspace(primaryIds, req.workspaceId!);
        const foundIds = new Set(found.map((competitor) => competitor.id));
        const missing = primaryIds.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          res.status(400).json({ error: "unknown_primary_competitor", missing });
          return;
        }
      }

      const saved = await deps.upsertCompanyProfileForWorkspace(
        {
          ...parsed.data,
          // workspace_id here just satisfies CompanyProfileInput's required
          // field — the second argument is the source of truth the function
          // itself writes with.
          workspace_id: req.workspaceId!,
          primary_competitor_ids: primaryIds,
        },
        req.workspaceId!
      );

      // The write succeeded. A stale cache self-heals on TTL and the update
      // queue is documented no-retry, so neither failure fails the request.
      try {
        await deps.invalidateProfileCache(req.workspaceId!);
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
