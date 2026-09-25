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
