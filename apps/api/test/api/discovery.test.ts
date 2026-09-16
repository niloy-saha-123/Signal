import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("@/agents/discovery-search/discovery-graph", () => ({
  discoveryGraph: { invoke: vi.fn() },
  DISCOVERY_RECURSION_LIMIT: 15,
  setupDiscoveryCheckpointer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/queues/registry", () => ({ addDiscoveryJob: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createDiscoveryRouter, type DiscoveryRouterDeps } from "@/api/discovery";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";

function buildTestApp(deps: DiscoveryRouterDeps) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspaceId = WORKSPACE_ID;
    next();
  });
  app.use("/", createDiscoveryRouter(deps));
  return app;
}

describe("POST /api/discovery/trigger", () => {
  it("enqueues a discovery job for the caller's workspace", async () => {
    const deps = { enqueueDiscovery: vi.fn().mockResolvedValue(undefined), resumeDiscovery: vi.fn() };
    const app = buildTestApp(deps);

    const res = await request(app).post("/trigger").send({});

    expect(res.status).toBe(202);
    expect(deps.enqueueDiscovery).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(deps.resumeDiscovery).not.toHaveBeenCalled();
  });
});

describe("POST /api/discovery/:threadId/resume", () => {
  it("resumes the interrupted graph with the decision", async () => {
    const deps = { enqueueDiscovery: vi.fn(), resumeDiscovery: vi.fn().mockResolvedValue(undefined) };
    const app = buildTestApp(deps);

    const res = await request(app).post(`/${WORKSPACE_ID}/resume`).send({ decision: "confirm" });

    expect(res.status).toBe(200);
    expect(deps.resumeDiscovery).toHaveBeenCalledWith(WORKSPACE_ID, "confirm");
  });

  it("rejects an invalid decision without resuming", async () => {
    const deps = { enqueueDiscovery: vi.fn(), resumeDiscovery: vi.fn() };
    const app = buildTestApp(deps);

    const res = await request(app).post(`/${WORKSPACE_ID}/resume`).send({ decision: "maybe" });

    expect(res.status).toBe(400);
    expect(deps.resumeDiscovery).not.toHaveBeenCalled();
  });

  it("forbids resuming a thread that belongs to another workspace", async () => {
    const deps = { enqueueDiscovery: vi.fn(), resumeDiscovery: vi.fn().mockResolvedValue(undefined) };
    const app = buildTestApp(deps);

    const res = await request(app)
      .post("/22222222-2222-2222-2222-222222222222/resume")
      .send({ decision: "confirm" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });
    expect(deps.resumeDiscovery).not.toHaveBeenCalled();
  });
});