// Company goals/plans CRUD — the manual-edit surface for the same company_goals
// table the chat agent (via update_company_goals) reads and writes. Workspace-
// scoped through req.workspaceId, like every other router; created_by is
// "user" because this route is the human-typed path (the agent path sets
// "agent" through the tool registry).
import express, { Router } from "express";
import { z } from "zod";
import * as queries from "../db/queries";
import { wrap, fallbackErrorHandler, requireUuidParam } from "./http";

export interface CompanyGoalsRouterDeps {
  listCompanyGoalsForWorkspace: typeof queries.listCompanyGoalsForWorkspace;
  createCompanyGoal: typeof queries.createCompanyGoal;
  updateCompanyGoal: typeof queries.updateCompanyGoal;
  deleteCompanyGoal: typeof queries.deleteCompanyGoal;
}

export const defaultCompanyGoalsRouterDeps: CompanyGoalsRouterDeps = {
  listCompanyGoalsForWorkspace: queries.listCompanyGoalsForWorkspace,
  createCompanyGoal: queries.createCompanyGoal,
  updateCompanyGoal: queries.updateCompanyGoal,
  deleteCompanyGoal: queries.deleteCompanyGoal,
};

const ListQuerySchema = z.object({
  status: z.enum(["active", "archived"]).optional(),
});

const CreateBodySchema = z.object({ content: z.string().trim().min(1).max(4000) }).strict();

const UpdateBodySchema = z
  .object({
    content: z.string().trim().min(1).max(4000).optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .strict();

export function createCompanyGoalsRouter(
  deps: CompanyGoalsRouterDeps = defaultCompanyGoalsRouterDeps
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
      const parsed = ListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const goals = await deps.listCompanyGoalsForWorkspace(
        req.workspaceId!,
        parsed.data.status === undefined ? undefined : { status: parsed.data.status }
      );
      res.status(200).json(goals);
    })
  );

  router.post(
    "/",
    wrap(async (req, res) => {
      const parsed = CreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const goal = await deps.createCompanyGoal(req.workspaceId!, parsed.data.content, "user");
      res.status(201).json(goal);
    })
  );

  router.patch(
    "/:id",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (!id) return;
      const parsed = UpdateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      if (Object.keys(parsed.data).length === 0) {
        res.status(400).json({ error: "validation", message: "no fields to update" });
        return;
      }
      const goal = await deps.updateCompanyGoal(id, req.workspaceId!, parsed.data);
      if (!goal) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.status(200).json(goal);
    })
  );

  router.delete(
    "/:id",
    wrap(async (req, res) => {
      const id = requireUuidParam(req, res);
      if (!id) return;
      await deps.deleteCompanyGoal(id, req.workspaceId!);
      res.status(204).end();
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}