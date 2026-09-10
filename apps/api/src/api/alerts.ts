// Express route for alert history.
//
// GET /api/alerts — keyset-paginated (created_at, id desc). Optional filters:
// competitor_ids (comma-separated), cursor, limit. Returns
// { data, next_cursor } with next_cursor an opaque string or null.
import express, { Router } from "express";
import { z } from "zod";
import * as queries from "../db/queries";
import { wrap, fallbackErrorHandler } from "./http";
import { decodeCursor, encodeCursor } from "./cursor";

export interface AlertRouterDeps {
  listAlertFeed: typeof queries.listAlertFeed;
}

export const defaultAlertRouterDeps: AlertRouterDeps = {
  listAlertFeed: queries.listAlertFeed,
};

const csvUuids = z
  .string()
  .transform((s) => s.split(","))
  .pipe(z.array(z.string().uuid()).min(1).max(50));

const QuerySchema = z
  .object({
    competitor_ids: csvUuids.optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export function createAlertRouter(deps: AlertRouterDeps = defaultAlertRouterDeps): Router {
  const router = express.Router();

  router.get(
    "/",
    wrap(async (req, res) => {
      const parsed = QuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const { limit, competitor_ids } = parsed.data;

      let cursor;
      if (parsed.data.cursor !== undefined) {
        try {
          cursor = decodeCursor(parsed.data.cursor);
        } catch {
          res.status(400).json({ error: "validation", message: "malformed cursor" });
          return;
        }
      }

      const rows = await deps.listAlertFeed({ limit, competitor_ids, cursor });

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
