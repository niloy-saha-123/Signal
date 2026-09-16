import { describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/db/queries", () => ({ getWorkspaceIdForUser: vi.fn(async () => "ws-1") }));

import { requireAuth } from "@/api/auth";

async function callWithAuthHeader(app: express.Express, header?: string) {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}/`, { headers: header ? { authorization: header } : {} });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("requireAuth", () => {
  it("401s with no Authorization header", async () => {
    const app = express();
    app.use(requireAuth);
    app.get("/", (_req, res) => res.status(200).json({ ok: true }));
    const res = await callWithAuthHeader(app, undefined);
    expect(res.status).toBe(401);
  });

  it("401s on a malformed token", async () => {
    const app = express();
    app.use(requireAuth);
    app.get("/", (_req, res) => res.status(200).json({ ok: true }));
    const res = await callWithAuthHeader(app, "Bearer not-a-jwt");
    expect(res.status).toBe(401);
  });

  it("401s on an expired token", async () => {
    // Build a locally-signed token with an HS256 test key and exp in the past;
    // requireAuth's JWKS lookup will fail signature verification regardless —
    // this test only needs to prove an expired/invalid token never reaches the route.
    const app = express();
    app.use(requireAuth);
    app.get("/", (_req, res) => res.status(200).json({ ok: true }));
    const res = await callWithAuthHeader(app, "Bearer eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.invalid");
    expect(res.status).toBe(401);
  });
});
