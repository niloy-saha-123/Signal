import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

import { createCompanyGoalsRouter, type CompanyGoalsRouterDeps } from "@/api/company-goals";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const GOAL_ID = "22222222-2222-4222-8222-222222222222";

function makeDeps(over: Partial<CompanyGoalsRouterDeps> = {}): CompanyGoalsRouterDeps {
  return {
    listCompanyGoalsForWorkspace: vi.fn(async () => []),
    createCompanyGoal: vi.fn(async () => ({
      id: GOAL_ID,
      workspace_id: WORKSPACE_ID,
      content: "goal",
      created_by: "user",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
    })) as any,
    updateCompanyGoal: vi.fn(async () => ({
      id: GOAL_ID,
      workspace_id: WORKSPACE_ID,
      content: "goal",
      created_by: "user",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
    })) as any,
    deleteCompanyGoal: vi.fn(async () => undefined),
    ...over,
  };
}

function buildApp(deps: CompanyGoalsRouterDeps): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspaceId = WORKSPACE_ID;
    next();
  });
  app.use("/", createCompanyGoalsRouter(deps));
  return app;
}

describe("GET /api/company-goals", () => {
  it("lists goals for the workspace", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).get("/");
    expect(res.status).toBe(200);
    expect(deps.listCompanyGoalsForWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, undefined);
  });

  it("passes a status filter through", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).get("/?status=archived");
    expect(res.status).toBe(200);
    expect(deps.listCompanyGoalsForWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, { status: "archived" });
  });

  it("400s on an invalid status", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).get("/?status=bogus");
    expect(res.status).toBe(400);
    expect(deps.listCompanyGoalsForWorkspace).not.toHaveBeenCalled();
  });
});

describe("POST /api/company-goals", () => {
  it("creates a user-authored goal", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).post("/").send({ content: "Expand to SMB" });
    expect(res.status).toBe(201);
    expect(deps.createCompanyGoal).toHaveBeenCalledWith(WORKSPACE_ID, "Expand to SMB", "user");
  });

  it("400s on a blank or missing content", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).post("/").send({ content: "   " });
    expect(res.status).toBe(400);
    expect(deps.createCompanyGoal).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/company-goals/:id", () => {
  it("updates the goal workspace-scoped", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).patch(`/${GOAL_ID}`).send({ status: "archived" });
    expect(res.status).toBe(200);
    expect(deps.updateCompanyGoal).toHaveBeenCalledWith(GOAL_ID, WORKSPACE_ID, { status: "archived" });
  });

  it("404s when the goal is not in this workspace", async () => {
    const deps = makeDeps({ updateCompanyGoal: vi.fn(async () => undefined) });
    const res = await request(buildApp(deps)).patch(`/${GOAL_ID}`).send({ content: "x" });
    expect(res.status).toBe(404);
  });

  it("400s on an empty update body", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).patch(`/${GOAL_ID}`).send({});
    expect(res.status).toBe(400);
    expect(deps.updateCompanyGoal).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/company-goals/:id", () => {
  it("deletes the goal workspace-scoped and returns 204", async () => {
    const deps = makeDeps();
    const res = await request(buildApp(deps)).delete(`/${GOAL_ID}`);
    expect(res.status).toBe(204);
    expect(deps.deleteCompanyGoal).toHaveBeenCalledWith(GOAL_ID, WORKSPACE_ID);
  });
});