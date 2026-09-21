// Express route to resolve company name + domain from a single user input.
// POST /api/resolve-company
//   Body: { input: string } — company name, domain, or URL
//   Returns: { name: string; domain: string }
import express, { Router, type RequestHandler } from "express";
import { z } from "zod";
import { normalizeDomain } from "../agents/discovery/competitor-discovery";
import { logger } from "../lib/logger";
import { wrap, fallbackErrorHandler } from "./http";

const BodySchema = z.object({ input: z.string().trim().min(1).max(500) }).strict();

// Heuristic: if input looks like a domain/URL, extract name from it
// Otherwise, treat as name and try to guess domain (common TLDs)
function resolveCompany(input: string): { name: string; domain: string } {
  const trimmed = input.trim();
  const probeDomain = normalizeDomain(trimmed);

  if (probeDomain) {
    // Input is a domain or URL — extract name from domain
    const nameFromDomain = probeDomain
      .replace(/^www\./, "")
      .split(".")[0]
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c: string) => c.toUpperCase());
    return { name: nameFromDomain, domain: probeDomain };
  }

  // Input is a name — guess common domain patterns
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^the|inc|corp|llc|ltd|ai|io|co$/g, "");

  // Try common TLDs in order of likelihood for B2B SaaS
  const commonTlds = [".com", ".io", ".ai", ".co", ".app", ".dev", ".so", ".tech"];
  const guessedDomain = `${slug}${commonTlds[0]}`;

  return { name: trimmed, domain: guessedDomain };
}

export function createResolveCompanyRouter(): Router {
  const router = express.Router();
  router.use(express.json());
  router.use((req, res, next) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "no_workspace" });
      return;
    }
    next();
  });

  router.post(
    "/",
    wrap(async (req, res) => {
      const parsed = BodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }

      const { name, domain } = resolveCompany(parsed.data.input);
      logger.info("resolve-company: input resolved", { input: parsed.data.input, name, domain });

      res.status(200).json({ name, domain });
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}