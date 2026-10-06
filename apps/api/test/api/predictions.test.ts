import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";

vi.mock("@/lib/redis-client", () => ({ redis: {}, cacheRedis: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createPredictionRouter, type PredictionRouterDeps } from "@/api/predictions";

const WS_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_WS_UUID = "99999999-9999-4999-8999-999999999999";
const USER_UUID = "33333333-3333-4333-8333-333333333333";
const COMPETITOR_UUID = "11111111-1111-4111-8111-111111111111";
const PREDICTION_UUID = "44444444-4444-4444-8444-444444444444";
const LINK_UUID = "55555555-5555-4555-8555-555555555555";

async function call(
  app: express.Express,
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function appWithUser(
  user: { id: string; workspaceId: string | null },
  router: express.Router
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: user.id, email: "test@example.com" };
    req.workspaceId = user.workspaceId;
    next();
  });
  app.use("/api/predictions", router);
  return app;
}

function prediction(overrides: Record<string, unknown> = {}) {
  return {
    id: PREDICTION_UUID,
    workspace_id: WS_UUID,
    competitor_id: COMPETITOR_UUID,
    statement: "Acme ships a first-party Postgres adapter in the next quarter",
    pattern_type: "product_launch",
    probability: 0.72,
    horizon_days: 90,
    resolves_at: new Date("2026-12-24T00:00:00.000Z"),
    evidence_signal_ids: [],
    evidence_count: 9,
    status: "open",
    resolved_at: null,
    resolution_note: null,
    resolution_evidence_urls: [],
    brier_score: null,
    created_at: new Date("2026-09-25T00:00:00.000Z"),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<PredictionRouterDeps> = {}): PredictionRouterDeps {
  return {
    listPredictionsForWorkspace: vi.fn().mockResolvedValue([]),
    getPredictionForWorkspace: vi.fn().mockResolvedValue(undefined),
    getCalibration: vi.fn().mockResolvedValue({
      resolved_count: 0,
      brier: null,
      baseline_brier: 0.25,
      buckets: [],
    }),
    voidPredictionForWorkspace: vi.fn().mockResolvedValue(false),
    getSignalsByIds: vi.fn().mockResolvedValue([]),
    listRoadmapLinks: vi.fn().mockResolvedValue([]),
    countRoadmapLinks: vi.fn().mockResolvedValue(0),
    countRoadmapLinksByPrediction: vi.fn().mockResolvedValue(new Map()),
    createRoadmapLink: vi.fn().mockImplementation(async (i) => ({ link: { id: LINK_UUID, ...i }, created: true })),
    updateRoadmapLink: vi.fn().mockResolvedValue({ id: LINK_UUID }),
    deleteRoadmapLink: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("GET /api/predictions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the caller's predictions", async () => {
    const deps = makeDeps({
      listPredictionsForWorkspace: vi.fn().mockResolvedValue([prediction()]),
    });
    const app = appWithUser({ id: USER_UUID, workspaceId: WS_UUID }, createPredictionRouter(deps));

    const res = await call(app, "/api/predictions");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].probability).toBe(0.72);
  });

  it("scopes every query to the caller's workspace", async () => {
    const listPredictionsForWorkspace = vi.fn().mockResolvedValue([]);
    const app = appWithUser(
      { id: USER_UUID, workspaceId: WS_UUID },
      createPredictionRouter(makeDeps({ listPredictionsForWorkspace }))
    );

    await call(app, "/api/predictions");

    expect(listPredictionsForWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: WS_UUID })
    );
  });

  it("rejects a caller with no workspace", async () => {
    const app = appWithUser(
      { id: USER_UUID, workspaceId: null },
      createPredictionRouter(makeDeps())
    );

    const res = await call(app, "/api/predictions");

    expect(res.status).toBe(403);
  });

  it("rejects an unknown status filter instead of ignoring it", async () => {
    // Silently dropping a filter it does not understand would show the user a
    // different set of predictions than the one they asked for.
    const app = appWithUser(
      { id: USER_UUID, workspaceId: WS_UUID },
      createPredictionRouter(makeDeps())
    );

    const res = await call(app, "/api/predictions?status=probably");

    expect(res.status).toBe(400);
  });

  it("passes through valid status and pattern filters", async () => {
    const listPredictionsForWorkspace = vi.fn().mockResolvedValue([]);
    const app = appWithUser(
      { id: USER_UUID, workspaceId: WS_UUID },
      createPredictionRouter(makeDeps({ listPredictionsForWorkspace }))
    );

    await call(app, "/api/predictions?status=hit&pattern_type=product_launch");

    expect(listPredictionsForWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ status: "hit", pattern_type: "product_launch" })
    );
  });
});

describe("GET /api/predictions/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the prediction with its evidence signals hydrated", async () => {
    const deps = makeDeps({
      getPredictionForWorkspace: vi
        .fn()
        .mockResolvedValue(prediction({ evidence_signal_ids: ["s1"] })),
      getSignalsByIds: vi.fn().mockResolvedValue([{ id: "s1", title: "PR #900" }]),
    });
    const app = appWithUser({ id: USER_UUID, workspaceId: WS_UUID }, createPredictionRouter(deps));

    const res = await call(app, `/api/predictions/${PREDICTION_UUID}`);

    expect(res.status).toBe(200);
    expect(res.body.evidence).toHaveLength(1);
    expect(res.body.evidence[0].title).toBe("PR #900");
  });

  it("returns 404, not 403, for a prediction in another workspace", async () => {
    // A 403 would confirm the id exists. 404 leaks nothing about what other
    // workspaces hold.
    const deps = makeDeps({ getPredictionForWorkspace: vi.fn().mockResolvedValue(undefined) });
    const app = appWithUser(
      { id: USER_UUID, workspaceId: OTHER_WS_UUID },
      createPredictionRouter(deps)
    );

    const res = await call(app, `/api/predictions/${PREDICTION_UUID}`);

    expect(res.status).toBe(404);
  });

  it("rejects a malformed id", async () => {
    const app = appWithUser(
      { id: USER_UUID, workspaceId: WS_UUID },
      createPredictionRouter(makeDeps())
    );

    const res = await call(app, "/api/predictions/not-a-uuid");

    expect(res.status).toBe(400);
  });
});

describe("GET /api/predictions/calibration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports an empty track record honestly rather than as a perfect score", async () => {
    const app = appWithUser(
      { id: USER_UUID, workspaceId: WS_UUID },
      createPredictionRouter(makeDeps())
    );

    const res = await call(app, "/api/predictions/calibration");

    expect(res.status).toBe(200);
    expect(res.body.resolved_count).toBe(0);
    expect(res.body.brier).toBeNull();
    expect(res.body.baseline_brier).toBeCloseTo(0.25, 10);
  });

  it("narrows to one competitor when asked", async () => {
    const getCalibration = vi.fn().mockResolvedValue({
      resolved_count: 3,
      brier: 0.12,
      baseline_brier: 0.25,
      buckets: [],
    });
    const app = appWithUser(
      { id: USER_UUID, workspaceId: WS_UUID },
      createPredictionRouter(makeDeps({ getCalibration }))
    );

    const res = await call(app, `/api/predictions/calibration?competitor_id=${COMPETITOR_UUID}`);

    expect(res.status).toBe(200);
    expect(getCalibration).toHaveBeenCalledWith(
      WS_UUID,
      expect.objectContaining({ competitorId: COMPETITOR_UUID })
    );
  });
});

describe("POST /api/predictions/:id/void", () => {
  beforeEach(() => vi.clearAllMocks());

  it("voids a prediction the caller owns", async () => {
    const voidPredictionForWorkspace = vi.fn().mockResolvedValue(true);
    const app = appWithUser(
      { id: USER_UUID, workspaceId: WS_UUID },
      createPredictionRouter(makeDeps({ voidPredictionForWorkspace }))
    );

    const res = await call(app, `/api/predictions/${PREDICTION_UUID}/void`, { method: "POST" });

    expect(res.status).toBe(200);
    expect(voidPredictionForWorkspace).toHaveBeenCalledWith(PREDICTION_UUID, WS_UUID);
  });

  it("returns 404 when the prediction is not the caller's to void", async () => {
    const app = appWithUser(
      { id: USER_UUID, workspaceId: OTHER_WS_UUID },
      createPredictionRouter(makeDeps({ voidPredictionForWorkspace: vi.fn().mockResolvedValue(false) }))
    );

    const res = await call(app, `/api/predictions/${PREDICTION_UUID}/void`, { method: "POST" });

    expect(res.status).toBe(404);
  });
});

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function linkApp(overrides: Partial<PredictionRouterDeps> = {}) {
  const deps = makeDeps({
    getPredictionForWorkspace: vi.fn().mockResolvedValue(prediction()),
    ...overrides,
  });
  return { deps, app: appWithUser({ id: USER_UUID, workspaceId: WS_UUID }, createPredictionRouter(deps)) };
}

describe("roadmap links", () => {
  beforeEach(() => vi.clearAllMocks());
  const base = `/api/predictions/${PREDICTION_UUID}/links`;
  const good = { title: "Postgres adapter", url: "https://acme.dev/roadmap/pg" };

  it("POST creates a link", async () => {
    const { deps, app } = linkApp();
    const res = await call(app, base, jsonInit("POST", good));
    expect(res.status).toBe(201);
    expect(deps.createRoadmapLink).toHaveBeenCalledWith({
      workspace_id: WS_UUID,
      prediction_id: PREDICTION_UUID,
      ...good,
      created_by: USER_UUID,
      stance: "watching",
    });
  });

  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x"])(
    "POST rejects %s",
    async (url) => {
      const { deps, app } = linkApp();
      const res = await call(app, base, jsonInit("POST", { ...good, url }));
      expect(res.status).toBe(400);
      expect(deps.createRoadmapLink).not.toHaveBeenCalled();
    }
  );

  it("POST rejects an empty title", async () => {
    const { app } = linkApp();
    expect((await call(app, base, jsonInit("POST", { ...good, title: "" }))).status).toBe(400);
  });

  it("POST 404s for a forecast outside the workspace", async () => {
    const { deps, app } = linkApp({ getPredictionForWorkspace: vi.fn().mockResolvedValue(undefined) });
    const res = await call(app, base, jsonInit("POST", good));
    expect(res.status).toBe(404);
    expect(deps.createRoadmapLink).not.toHaveBeenCalled();
  });

  it("POST 409s at the link limit", async () => {
    const { deps, app } = linkApp({ countRoadmapLinks: vi.fn().mockResolvedValue(10) });
    const res = await call(app, base, jsonInit("POST", good));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "link_limit" });
    expect(deps.createRoadmapLink).not.toHaveBeenCalled();
  });

  it("POST with a URL already on the forecast returns the existing link", async () => {
    const existing = { id: LINK_UUID, ...good };
    const { app } = linkApp({
      createRoadmapLink: vi.fn().mockResolvedValue({ link: existing, created: false }),
    });
    const res = await call(app, base, jsonInit("POST", good));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(existing);
  });

  it.each(["hit", "miss", "unresolved", "void"])("links are locked on a %s forecast", async (status) => {
    const { deps, app } = linkApp({
      getPredictionForWorkspace: vi.fn().mockResolvedValue(prediction({ status })),
    });
    const post = await call(app, base, jsonInit("POST", good));
    const patch = await call(app, `${base}/${LINK_UUID}`, jsonInit("PATCH", { stance: "accelerate" }));
    const del = await call(app, `${base}/${LINK_UUID}`, { method: "DELETE" });
    for (const res of [post, patch, del]) {
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "forecast_settled" });
    }
    expect(deps.createRoadmapLink).not.toHaveBeenCalled();
    expect(deps.updateRoadmapLink).not.toHaveBeenCalled();
    expect(deps.deleteRoadmapLink).not.toHaveBeenCalled();
  });

  it("PATCH and DELETE 404 for a forecast outside the workspace", async () => {
    const { deps, app } = linkApp({ getPredictionForWorkspace: vi.fn().mockResolvedValue(undefined) });
    expect(
      (await call(app, `${base}/${LINK_UUID}`, jsonInit("PATCH", { stance: "accelerate" }))).status
    ).toBe(404);
    expect((await call(app, `${base}/${LINK_UUID}`, { method: "DELETE" })).status).toBe(404);
    expect(deps.updateRoadmapLink).not.toHaveBeenCalled();
    expect(deps.deleteRoadmapLink).not.toHaveBeenCalled();
  });

  it("POST rejects a non-uuid id", async () => {
    const { app } = linkApp();
    expect((await call(app, "/api/predictions/nope/links", jsonInit("POST", good))).status).toBe(400);
  });

  it("PATCH changes the stance", async () => {
    const { deps, app } = linkApp();
    const res = await call(app, `${base}/${LINK_UUID}`, jsonInit("PATCH", { stance: "accelerate" }));
    expect(res.status).toBe(200);
    expect(deps.updateRoadmapLink).toHaveBeenCalledWith(LINK_UUID, PREDICTION_UUID, WS_UUID, {
      stance: "accelerate",
    });
  });

  it("PATCH rejects an empty body", async () => {
    const { app } = linkApp();
    expect((await call(app, `${base}/${LINK_UUID}`, jsonInit("PATCH", {}))).status).toBe(400);
  });

  it("PATCH 404s when no row matches", async () => {
    const { app } = linkApp({ updateRoadmapLink: vi.fn().mockResolvedValue(null) });
    expect(
      (await call(app, `${base}/${LINK_UUID}`, jsonInit("PATCH", { stance: "accelerate" }))).status
    ).toBe(404);
  });

  it("PATCH rejects a url in the body", async () => {
    const { app } = linkApp();
    expect(
      (await call(app, `${base}/${LINK_UUID}`, jsonInit("PATCH", { url: "https://x.dev" }))).status
    ).toBe(400);
  });

  it("DELETE answers 204 with no body", async () => {
    const { app } = linkApp();
    const res = await call(app, `${base}/${LINK_UUID}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("DELETE 404s when nothing was deleted", async () => {
    const { app } = linkApp({ deleteRoadmapLink: vi.fn().mockResolvedValue(false) });
    expect((await call(app, `${base}/${LINK_UUID}`, { method: "DELETE" })).status).toBe(404);
  });

  it("DELETE rejects a non-uuid linkId", async () => {
    const { app } = linkApp();
    expect((await call(app, `${base}/nope`, { method: "DELETE" })).status).toBe(400);
  });

  it("GET /:id includes roadmap_links", async () => {
    const links = [{ id: LINK_UUID, title: "x" }];
    const { deps, app } = linkApp({ listRoadmapLinks: vi.fn().mockResolvedValue(links) });
    const res = await call(app, `/api/predictions/${PREDICTION_UUID}`);
    expect(res.body.roadmap_links).toEqual(links);
    expect(deps.listRoadmapLinks).toHaveBeenCalledWith(PREDICTION_UUID, WS_UUID);
  });

  it("GET / adds roadmap_link_count from one batched call", async () => {
    const other = "66666666-6666-4666-8666-666666666666";
    const countRoadmapLinksByPrediction = vi.fn().mockResolvedValue(new Map([[PREDICTION_UUID, 3]]));
    const { app } = linkApp({
      listPredictionsForWorkspace: vi
        .fn()
        .mockResolvedValue([prediction(), prediction({ id: other })]),
      countRoadmapLinksByPrediction,
    });
    const res = await call(app, "/api/predictions");
    expect(countRoadmapLinksByPrediction).toHaveBeenCalledTimes(1);
    expect(countRoadmapLinksByPrediction).toHaveBeenCalledWith([PREDICTION_UUID, other], WS_UUID);
    expect(res.body.data.map((r: any) => r.roadmap_link_count)).toEqual([3, 0]);
  });

  it("GET / still lists forecasts when the count query fails", async () => {
    const { app } = linkApp({
      listPredictionsForWorkspace: vi.fn().mockResolvedValue([prediction()]),
      countRoadmapLinksByPrediction: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const res = await call(app, "/api/predictions");
    expect(res.status).toBe(200);
    expect(res.body.data[0].roadmap_link_count).toBe(0);
  });

  it("GET /:id still returns the forecast when the links query fails", async () => {
    const { app } = linkApp({ listRoadmapLinks: vi.fn().mockRejectedValue(new Error("db down")) });
    const res = await call(app, `/api/predictions/${PREDICTION_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.roadmap_links).toEqual([]);
  });
});
