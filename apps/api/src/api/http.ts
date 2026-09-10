// Shared HTTP plumbing for the route factories: async-handler wrapping, a
// minimal per-router fallback error handler (Task 5 replaces it with a central
// one), and the uuid `:id` param check that every competitor sub-route needs.
import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function wrap(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// Placeholder until Task 5's central error handler. Redacts the error — never
// leak internals to the client — but logs it in full.
export const fallbackErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error("Unhandled route error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  if (res.headersSent) return;
  res.status(500).json({ error: "internal" });
};

const uuidSchema = z.string().uuid();

// Returns the validated id, or null after having already sent a 400. A
// malformed uuid is a client error, not a 404 (plan ruling 2).
export function requireUuidParam(req: Request, res: Response, name = "id"): string | null {
  const parsed = uuidSchema.safeParse(req.params[name]);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", issues: parsed.error.issues });
    return null;
  }
  return parsed.data;
}
