// fetch_url SSRF + content-policy tests. dns.lookup and global fetch are
// mocked so nothing leaves the process; safe-fetch's public-IP check still
// runs against the mocked answers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

vi.mock("@/reliability/circuit-breaker", () => ({
  withCircuitBreaker: (_service: string, fn: () => unknown) => fn(),
}));

const { consumeBudgetMock } = vi.hoisted(() => ({ consumeBudgetMock: vi.fn() }));
vi.mock("@/agents/chat/input-budget", () => ({
  consumeChatInputBudget: (...args: unknown[]) => consumeBudgetMock(...args),
}));

import { FetchUrlError, fetchUrlPage, isVideoHost } from "@/agents/chat/fetch-url";

const PUBLIC_ANSWER = [{ address: "93.184.216.34", family: 4 }];
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000000";

function htmlResponse(body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...extra },
  });
}

describe("agents/chat/fetch-url — isVideoHost", () => {
  it.each([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "vimeo.com",
    "player.vimeo.com",
    "loom.com",
    "www.tiktok.com",
    "dailymotion.com",
    "www.twitch.tv",
  ])("flags %s as a video host", (host) => {
    expect(isVideoHost(host)).toBe(true);
  });

  it.each(["acme.com", "docs.acme.com", "blog.example.org"])("allows %s", (host) => {
    expect(isVideoHost(host)).toBe(false);
  });
});

describe("agents/chat/fetch-url — fetchUrlPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    lookupMock.mockResolvedValue(PUBLIC_ANSWER);
    consumeBudgetMock.mockResolvedValue(undefined);
    fetchMock = vi.fn().mockResolvedValue(htmlResponse("<html><body><p>hello</p></body></html>"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["file:", "file:///etc/passwd"],
    ["gopher:", "gopher://acme.com/1"],
    ["data:", "data:text/html,hi"],
  ])("refuses the %s scheme without connecting", async (_label, url) => {
    await expect(fetchUrlPage(url, WORKSPACE_ID)).rejects.toThrow(/scheme|unsupported/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/latest/meta-data/"])(
    "refuses %s without connecting",
    async (url) => {
      await expect(fetchUrlPage(url, WORKSPACE_ID)).rejects.toThrow(FetchUrlError);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("refuses a host that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(fetchUrlPage("https://probe.attacker.com/", WORKSPACE_ID)).rejects.toThrow(
      /non-public/i
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a youtube URL before connecting", async () => {
    await expect(
      fetchUrlPage("https://www.youtube.com/watch?v=dQw4w9WgXcQ", WORKSPACE_ID)
    ).rejects.toMatchObject({ code: "video" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns stripped text for a public HTML page", async () => {
    fetchMock.mockResolvedValueOnce(
      htmlResponse(
        "<html><head><script>alert(1)</script></head><body><article>Pricing dropped 20%</article></body></html>"
      )
    );
    const text = await fetchUrlPage("https://acme.com/pricing", WORKSPACE_ID);
    expect(text).toContain("Pricing dropped 20%");
    expect(text).not.toContain("alert");
    expect(consumeBudgetMock).toHaveBeenCalledWith("fetch_url", WORKSPACE_ID);
  });

  it("blocks a redirect that lands on a video host", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://youtu.be/abc" } })
    );
    await expect(fetchUrlPage("https://acme.com/watch", WORKSPACE_ID)).rejects.toMatchObject({
      code: "video",
    });
  });

  it("blocks a redirect into link-local metadata", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      })
    );
    await expect(fetchUrlPage("https://acme.com/pricing", WORKSPACE_ID)).rejects.toThrow(
      /non-public/i
    );
  });

  it("rejects a disallowed Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("MZ", { status: 200, headers: { "content-type": "application/octet-stream" } })
    );
    await expect(fetchUrlPage("https://acme.com/payload.bin", WORKSPACE_ID)).rejects.toMatchObject({
      code: "content_type",
    });
  });

  it("enforces the 1 MB response byte cap", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("x".repeat(1_000_001), {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    );
    await expect(fetchUrlPage("https://acme.com/huge.txt", WORKSPACE_ID)).rejects.toThrow(/exceeded/i);
  });

  it("returns JSON bodies as text", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"plan":"pro"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await expect(fetchUrlPage("https://acme.com/api/plan", WORKSPACE_ID)).resolves.toBe(
      '{"plan":"pro"}'
    );
  });
});
