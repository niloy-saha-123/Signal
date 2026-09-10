// Express route for the paginated, filterable signal feed.
//
// GET /api/signals — keyset-paginated (created_at, id desc). All filters
// competitor_ids is required; sources (comma-separated), min_quality,
// created_after / created_before, cursor, limit. Returns
// { data, next_cursor } where next_cursor is an opaque string or null.
import express, { Router } from "express";
import { z } from "zod";
import { SignalSourceSchema } from "@signal/shared";
import * as queries from "../db/queries";
import { wrap, fallbackErrorHandler } from "./http";
import { decodeCursor, encodeCursor } from "./cursor";

export interface SignalRouterDeps {
  listSignalFeed: typeof queries.listSignalFeed;
}

export const defaultSignalRouterDeps: SignalRouterDeps = {
  listSignalFeed: queries.listSignalFeed,
};

const csvUuids = z
  .string()
  .transform((s) => s.split(","))
  .pipe(z.array(z.string().uuid()).min(1).max(50));

const csvSources = z
  .string()
  .transform((s) => s.split(","))
  .pipe(z.array(SignalSourceSchema).min(1).max(SignalSourceSchema.options.length));

const QuerySchema = z
  .object({
    competitor_ids: csvUuids,
    sources: csvSources.optional(),
    min_quality: z.coerce.number().min(0).max(1).optional(),
    created_after: z.coerce.date().optional(),
    created_before: z.coerce.date().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export function createSignalRouter(deps: SignalRouterDeps = defaultSignalRouterDeps): Router {
  const router = express.Router();

  router.get(
    "/",
    wrap(async (req, res) => {
      const parsed = QuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const { limit, competitor_ids, sources, min_quality, created_after, created_before } =
        parsed.data;

      let cursor;
      if (parsed.data.cursor !== undefined) {
        try {
          cursor = decodeCursor(parsed.data.cursor);
        } catch {
          res.status(400).json({ error: "validation", message: "malformed cursor" });
          return;
        }
      }

      const rows = await deps.listSignalFeed({
        limit,
        competitor_ids,
        sources,
        min_quality,
        created_after,
        created_before,
        cursor,
      });

      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      const last = data[data.length - 1];
      const next_cursor =
        hasMore && last ? encodeCursor({ created_at: last.created_at, id: last.id }) : null;

      res.status(200).json({ data, next_cursor });
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
