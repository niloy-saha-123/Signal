import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMock, parseURLMock, withRetryMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  parseURLMock: vi.fn(),
  withRetryMock: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../lib/logger", () => ({ logger: loggerMock }));
vi.mock("../../lib/retry", () => ({ withRetry: withRetryMock }));
vi.mock("rss-parser", () => ({
  default: class {
    parseURL(url: string) {
      return parseURLMock(url);
    }
  },
}));

import {
  discoverCompetitor,
  isPublicDomain,
  normalizeDomain,
  slugVariants,
} from "./competitor-discovery";

type ResponseOptions = {
  status?: number;
  url?: string;
  json?: unknown;
  text?: string;
};

function response(options: ResponseOptions = {}): Response {
  const status = options.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    url: options.url ?? "",
    json: vi.fn().mockResolvedValue(options.json ?? {}),
    text: vi.fn().mockResolvedValue(options.text ?? ""),
  } as unknown as Response;
}

const emptyExisting = {
  subreddits: [] as string[],
  greenhouse_token: null,
  lever_token: null,
  pricing_url: null,
  changelog_rss: null,
};

function logFor(result: Awaited<ReturnType<typeof discoverCompetitor>>, field: string) {
  const log = result.logs.find((entry) => entry.field_name === field);
  if (!log) throw new Error(`missing discovery log for ${field}`);
  return log;
}

describe("agents/discovery/competitor-discovery", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    parseURLMock.mockRejectedValue(new Error("not a feed"));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes domains and builds ordered, de-duplicated ATS slug variants", () => {
    expect(normalizeDomain("  HTTPS://www.Acme-Cloud.COM/path/  ")).toBe("acme-cloud.com");
    expect(slugVariants("acme-cloud.com", "Acme Cloud Inc.")).toEqual([
      "acme-cloud",
      "acme-cloud-inc",
      "acmecloud",
      "acmecloudinc",
    ]);
  });

  it("rejects local, literal-IP, non-HTTP, and userinfo-smuggled probe domains", () => {
    expect(isPublicDomain(normalizeDomain("localhost"))).toBe(false);
    expect(isPublicDomain(normalizeDomain("http://127.0.0.1/admin"))).toBe(false);
    expect(isPublicDomain(normalizeDomain("file://localhost/etc/passwd"))).toBe(false);
    expect(isPublicDomain(normalizeDomain("https://user@127.0.0.1/admin"))).toBe(false);
    expect(isPublicDomain(normalizeDomain("https://acme.com"))).toBe(true);
  });

  it("discovers all five fields and ranks subreddits by mention count", async () => {
    parseURLMock.mockImplementation(async (url: string) => {
      if (url === "https://acme.com/blog/rss") return { items: [] };
      throw new Error("not a feed");
    });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("reddit.com") && url.includes("type=sr")) {
        return response({
          json: { data: { children: [{ data: { display_name: "AcmeUsers" } }] } },
        });
      }
      if (url.includes("reddit.com")) {
        return response({
          json: {
            data: {
              children: [
                { data: { subreddit: "SaaSBuilders" } },
                { data: { subreddit: "SaaSBuilders" } },
                { data: { subreddit: "SaaSBuilders" } },
                { data: { subreddit: "AcmeUsers" } },
              ],
            },
          },
        });
      }
      if (url.includes("greenhouse.io/v1/boards/acme/jobs")) {
        return response({ json: { jobs: [{ id: 1 }] } });
      }
      if (url.includes("api.lever.co/v0/postings/acme")) {
        return response({ json: [{ id: "job-1" }] });
      }
      if (url === "https://acme.com/pricing" && init?.method === "HEAD") {
        return response({ url });
      }
      return response({ status: 404, url });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "https://www.acme.com/",
      existing: emptyExisting,
    });

    expect(result).toMatchObject({
      greenhouse_token: "acme",
      lever_token: "acme",
      pricing_url: "https://acme.com/pricing",
      changelog_rss: "https://acme.com/blog/rss",
    });
    expect(result.subreddits.slice(0, 2)).toEqual(["SaaSBuilders", "AcmeUsers"]);
    expect(result.subreddits).toEqual(expect.arrayContaining(["SaaS", "startups"]));
    expect(result.logs.map((entry) => entry.field_name)).toEqual([
      "subreddits",
      "greenhouse",
      "lever",
      "pricing_url",
      "rss_url",
    ]);
    expect(result.logs.every((entry) => entry.status === "found")).toBe(true);
  });

  it("records misses without losing the two default subreddits", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) {
        return response({ json: { data: { children: [] } } });
      }
      if (url === "https://acme.com/") return response({ text: "<html></html>", url });
      return response({ status: 404, url });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    expect(result.subreddits).toEqual(["SaaS", "startups"]);
    expect(logFor(result, "subreddits").status).toBe("found");
    for (const field of ["greenhouse", "lever", "pricing_url", "rss_url"]) {
      expect(logFor(result, field).status).toBe("not_found");
    }
  });

  it("isolates a network failure to its field while other strategies complete", async () => {
    parseURLMock.mockImplementation(async (url: string) => {
      if (url === "https://acme.com/blog/rss") return { items: [] };
      throw new Error("not a feed");
    });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url === "https://acme.com/pricing" && init?.method === "HEAD") {
        throw new Error("pricing host timed out");
      }
      return response({ status: 404, url });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    expect(logFor(result, "pricing_url")).toMatchObject({
      status: "error",
      error_message: "pricing host timed out",
    });
    expect(logFor(result, "rss_url").status).toBe("found");
    expect(logFor(result, "greenhouse").status).toBe("not_found");
  });

  it("falls through ordered slug variants until a real job board is found", async () => {
    parseURLMock.mockResolvedValue({ items: [] });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url.includes("greenhouse.io/v1/boards/acme-cloud/jobs")) {
        return response({ status: 404, url });
      }
      if (url.includes("greenhouse.io/v1/boards/acme-cloud-inc/jobs")) {
        return response({ json: { jobs: [{ id: 1 }] }, url });
      }
      if (url === "https://acme-cloud.com/pricing") return response({ url });
      return response({ status: 404, url });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme Cloud Inc.",
      domain: "acme-cloud.com",
      existing: emptyExisting,
    });

    expect(result.greenhouse_token).toBe("acme-cloud-inc");
    expect(logFor(result, "greenhouse").attempted_urls).toEqual([
      "https://boards-api.greenhouse.io/v1/boards/acme-cloud/jobs",
      "https://boards-api.greenhouse.io/v1/boards/acme-cloud-inc/jobs",
    ]);
  });

  it("probes pricing paths in order and stops after the first successful path", async () => {
    parseURLMock.mockResolvedValue({ items: [] });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (init?.method === "HEAD" && url === "https://acme.com/pricing") {
        return response({ status: 404, url });
      }
      if (init?.method === "HEAD" && url === "https://acme.com/plans") {
        return response({ url });
      }
      return response({ status: 404, url });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    expect(result.pricing_url).toBe("https://acme.com/plans");
    expect(logFor(result, "pricing_url").attempted_urls).toEqual([
      "https://acme.com/pricing",
      "https://acme.com/plans",
    ]);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://acme.com/price",
      expect.objectContaining({ method: "HEAD" })
    );
  });

  it("uses a valid RSS alternate link from the homepage after path probes miss", async () => {
    const alternate = "https://feeds.acme.com/releases.xml";
    parseURLMock.mockImplementation(async (url: string) => {
      if (url === alternate) return { items: [] };
      throw new Error("not a feed");
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url === "https://acme.com/") {
        return response({
          url,
          text: `<html><head><link rel="alternate" type="application/rss+xml" href="${alternate}"></head></html>`,
        });
      }
      return response({ status: 404, url });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    expect(result.changelog_rss).toBe(alternate);
    expect(logFor(result, "rss_url").attempted_urls.at(-1)).toBe(alternate);
  });

  it("starts the fixed RSS path probes together so timeouts do not serialize", async () => {
    const resolvers: Array<(value: { items: unknown[] }) => void> = [];
    parseURLMock.mockImplementation(
      () => new Promise<{ items: unknown[] }>((resolve) => resolvers.push(resolve))
    );

    const pending = discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: {
        ...emptyExisting,
        subreddits: ["acme"],
        greenhouse_token: "acme-gh",
        lever_token: "acme-lever",
        pricing_url: "https://acme.com/pricing",
      },
    });

    await vi.waitFor(() => expect(parseURLMock).toHaveBeenCalledTimes(9));
    for (const resolve of resolvers) resolve({ items: [] });

    const result = await pending;
    expect(result.changelog_rss).toBe("https://acme.com/blog/rss");
    expect(logFor(result, "rss_url").attempted_urls).toHaveLength(9);
  });

  it("does not fetch an RSS alternate link that targets a private host", async () => {
    const privateFeed = "http://127.0.0.1/internal.xml";
    parseURLMock.mockRejectedValue(new Error("not a feed"));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url === "https://acme.com/") {
        return response({
          url,
          text: `<html><head><link rel="alternate" type="application/rss+xml" href="${privateFeed}"></head></html>`,
        });
      }
      return response({ status: 404, url });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    expect(result.changelog_rss).toBeNull();
    expect(parseURLMock).not.toHaveBeenCalledWith(privateFeed);
  });

  it("preserves pre-filled values and performs no discovery or logging for them", async () => {
    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: {
        subreddits: ["acme"],
        greenhouse_token: "acme-gh",
        lever_token: "acme-lever",
        pricing_url: "https://acme.com/custom-pricing",
        changelog_rss: "https://acme.com/custom-feed.xml",
      },
    });

    expect(result).toEqual({
      subreddits: ["acme"],
      greenhouse_token: "acme-gh",
      lever_token: "acme-lever",
      pricing_url: "https://acme.com/custom-pricing",
      changelog_rss: "https://acme.com/custom-feed.xml",
      logs: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(parseURLMock).not.toHaveBeenCalled();
  });

  it("never interpolates a rejected userinfo/private-IP domain into probe URLs", async () => {
    parseURLMock.mockRejectedValue(new Error("not a feed"));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      return response({ status: 404, url });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "https://user@127.0.0.1/admin",
      existing: emptyExisting,
    });

    expect(logFor(result, "pricing_url").status).toBe("error");
    expect(logFor(result, "rss_url").status).toBe("error");
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("127.0.0.1"))).toBe(true);
  });
});
