import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const getSession = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser, getSession },
  })),
}));

import { middleware } from "../middleware";

const BASE = "http://localhost:3000";

function makeRequest(pathname: string) {
  return new NextRequest(new URL(pathname, BASE));
}

function fakeAccessToken(claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("middleware", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    getUser.mockReset();
    getSession.mockReset();
  });

  describe("no session", () => {
    beforeEach(() => {
      getUser.mockResolvedValue({ data: { user: null } });
    });

    it("redirects a protected path to /login", async () => {
      const response = await middleware(makeRequest("/board"));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`${BASE}/login`);
    });

    it.each(["/login", "/signup"])("passes %s through without redirecting", async (pathname) => {
      const response = await middleware(makeRequest(pathname));
      expect(response.headers.get("location")).toBeNull();
    });
  });

  describe("session but no workspace", () => {
    beforeEach(() => {
      getUser.mockResolvedValue({ data: { user: { id: "user-1", app_metadata: {} } } });
      getSession.mockResolvedValue({
        data: { session: { access_token: fakeAccessToken({ sub: "user-1" }) } },
      });
    });

    it("redirects a protected path to /onboarding", async () => {
      const response = await middleware(makeRequest("/board"));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`${BASE}/onboarding`);
    });

    it.each(["/onboarding", "/login", "/signup"])(
      "passes %s through without redirecting",
      async (pathname) => {
        const response = await middleware(makeRequest(pathname));
        expect(response.headers.get("location")).toBeNull();
      }
    );
  });

  describe("session with workspace", () => {
    beforeEach(() => {
      getUser.mockResolvedValue({ data: { user: { id: "user-1", app_metadata: {} } } });
      getSession.mockResolvedValue({
        data: {
          session: {
            access_token: fakeAccessToken({ sub: "user-1", workspace_id: "ws-1" }),
          },
        },
      });
    });

    it("passes a protected path through", async () => {
      const response = await middleware(makeRequest("/board"));
      expect(response.headers.get("location")).toBeNull();
    });
  });
});
