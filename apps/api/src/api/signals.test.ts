import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";

vi.mock("../lib/redis-client", () => ({ redis: {}, cacheRedis: {} }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createSignalRouter, type SignalRouterDeps } from "./signals";
import { decodeCursor, encodeCursor } from "./cursor";

const UUID = "11111111-1111-4111-8111-111111111111";

async function call(app: express.Express, path: string): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const rowId = (i: number) => `1111111${i}-1111-4111-8111-111111111111`;

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: rowId(i),
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n - i)),
    raw_text: `s${i}`,
  }));
}

const app = (deps: SignalRouterDeps) =>
  express().use("/api/signals", createSignalRouter(deps));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/signals", () => {
  it("returns data + null next_cursor on a short page", async () => {
    const deps: SignalRouterDeps = { listSignalFeed: vi.fn(async () => rows(3)) as any };
    const res = await call(app(deps), `/api/signals?competitor_ids=${UUID}&limit=10`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.next_cursor).toBeNull();
  });

  it("sets next_cursor on a full page and round-trips it", async () => {
    const deps: SignalRouterDeps = { listSignalFeed: vi.fn(async () => rows(3)) as any };
    const res = await call(app(deps), `/api/signals?competitor_ids=${UUID}&limit=2`);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.next_cursor).toEqual(expect.any(String));

    const decoded = decodeCursor(res.body.next_cursor);
    expect(decoded.id).toBe(rowId(1));

    // feeding it back parses cleanly into the feed query
    const deps2: SignalRouterDeps = { listSignalFeed: vi.fn(async () => []) as any };
    const res2 = await call(
      app(deps2),
      `/api/signals?competitor_ids=${UUID}&limit=2&cursor=${res.body.next_cursor}`
    );
    expect(res2.status).toBe(200);
    const passedCursor = (deps2.listSignalFeed as any).mock.calls[0][0].cursor;
    expect(passedCursor.id).toBe(rowId(1));
  });

  it("400 on a garbage cursor", async () => {
    const deps: SignalRouterDeps = { listSignalFeed: vi.fn(async () => []) as any };
    const res = await call(app(deps), "/api/signals?cursor=not-base64-json");
    expect(res.status).toBe(400);
    expect(deps.listSignalFeed).not.toHaveBeenCalled();
  });

  it("400 on an unknown query key", async () => {
    const deps: SignalRouterDeps = { listSignalFeed: vi.fn(async () => []) as any };
    const res = await call(app(deps), "/api/signals?bogus=1");
    expect(res.status).toBe(400);
  });

  it("400 on min_quality out of range", async () => {
    const deps: SignalRouterDeps = { listSignalFeed: vi.fn(async () => []) as any };
    const res = await call(app(deps), "/api/signals?min_quality=5");
    expect(res.status).toBe(400);
  });

  it("400 on a non-uuid in competitor_ids", async () => {
    const deps: SignalRouterDeps = { listSignalFeed: vi.fn(async () => []) as any };
    const res = await call(app(deps), "/api/signals?competitor_ids=abc,def");
    expect(res.status).toBe(400);
  });

  it("400 when competitor_ids is omitted", async () => {
    const deps: SignalRouterDeps = { listSignalFeed: vi.fn(async () => []) as any };
    const res = await call(app(deps), "/api/signals?limit=10");
    expect(res.status).toBe(400);
    expect(deps.listSignalFeed).not.toHaveBeenCalled();
  });

  it("parses comma-separated filters and coerced values", async () => {
    const deps: SignalRouterDeps = { listSignalFeed: vi.fn(async () => []) as any };
    await call(
      app(deps),
      `/api/signals?competitor_ids=${UUID}&sources=reddit,hn&min_quality=0.5&limit=7`
    );
    expect((deps.listSignalFeed as any).mock.calls[0][0]).toMatchObject({
      competitor_ids: [UUID],
      sources: ["reddit", "hn"],
      min_quality: 0.5,
      limit: 7,
    });
  });

  it("cursor codec round-trips created_at + id", () => {
    const c = { created_at: new Date("2026-02-03T04:05:06.000Z"), id: UUID };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
});
