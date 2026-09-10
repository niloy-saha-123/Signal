import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMock, parseStringMock, withRetryMock, lookupMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  parseStringMock: vi.fn(),
  // Real retry semantics minus the backoff sleep, so "this probe is not
  // retried" is an assertion the mock can't accidentally satisfy.
  withRetryMock: vi.fn(async (fn: () => Promise<unknown>, opts?: { maxAttempts?: number }) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < (opts?.maxAttempts ?? 3); attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }),
  lookupMock: vi.fn(),
}));

vi.mock("../../lib/logger", () => ({ logger: loggerMock }));
vi.mock("../../lib/retry", () => ({ withRetry: withRetryMock }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("rss-parser", () => ({
  default: class {
    parseString(text: string) {
      return parseStringMock(text);
    }
  },
}));

import { discoverCompetitor, normalizeDomain, slugVariants } from "./competitor-discovery";

const PUBLIC_ANSWER = [{ address: "93.184.216.34", family: 4 }];
const FEED_XML = "<rss><channel><title>Acme</title></channel></rss>";

type ResponseOptions = {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
};

// safe-fetch reads bodies through a real capped stream reader, so these have to
// be real Responses rather than a duck-typed object.
function response(options: ResponseOptions = {}): Response {
  const status = options.status ?? 200;
  const body = options.json !== undefined ? JSON.stringify(options.json) : (options.text ?? "");
  return new Response(body, { status, headers: options.headers });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
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
    lookupMock.mockResolvedValue(PUBLIC_ANSWER);
    parseStringMock.mockImplementation(async (text: string) => {
      if (text === FEED_XML) return { items: [] };
      throw new Error("not a feed");
    });
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

  it("rejects non-HTTP, userinfo-smuggled, and ported domains before they become probe URLs", () => {
    expect(normalizeDomain("file://localhost/etc/passwd")).toBe("");
    expect(normalizeDomain("https://user@127.0.0.1/admin")).toBe("");
    expect(normalizeDomain("https://acme.com:8443")).toBe("");
    expect(normalizeDomain("https://acme.com")).toBe("acme.com");
  });

  it("discovers all five fields and ranks subreddits by mention count", async () => {
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
        return response();
      }
      if (url === "https://acme.com/blog/rss") return response({ text: FEED_XML });
      return response({ status: 404 });
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
      if (url === "https://acme.com/") return response({ text: "<html></html>" });
      return response({ status: 404 });
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
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url === "https://acme.com/pricing" && init?.method === "HEAD") {
        throw new Error("pricing host timed out");
      }
      if (url === "https://acme.com/blog/rss") return response({ text: FEED_XML });
      return response({ status: 404 });
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
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url.includes("greenhouse.io/v1/boards/acme-cloud/jobs")) {
        return response({ status: 404 });
      }
      if (url.includes("greenhouse.io/v1/boards/acme-cloud-inc/jobs")) {
        return response({ json: { jobs: [{ id: 1 }] } });
      }
      if (url === "https://acme-cloud.com/pricing") return response();
      return response({ status: 404 });
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
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (init?.method === "HEAD" && url === "https://acme.com/pricing") {
        return response({ status: 404 });
      }
      if (init?.method === "HEAD" && url === "https://acme.com/plans") {
        return response();
      }
      return response({ status: 404 });
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
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url === "https://acme.com/") {
        return response({
          text: `<html><head><link rel="alternate" type="application/rss+xml" href="${alternate}"></head></html>`,
        });
      }
      if (url === alternate) return response({ text: FEED_XML });
      return response({ status: 404 });
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
    const pendingFeeds: Array<(res: Response) => void> = [];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("https://acme.com/")) {
        return new Promise<Response>((resolve) => pendingFeeds.push(resolve));
      }
      return response({ status: 404 });
    });

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

    await vi.waitFor(() => expect(pendingFeeds).toHaveLength(9));
    pendingFeeds.forEach((resolve, index) =>
      resolve(index === 0 ? response({ text: FEED_XML }) : response({ status: 404 }))
    );

    const result = await pending;
    expect(result.changelog_rss).toBe("https://acme.com/blog/rss");
    expect(logFor(result, "rss_url").attempted_urls).toHaveLength(9);
  });

  it("does not fetch an RSS alternate link that targets a private host", async () => {
    const privateFeed = "http://127.0.0.1/internal.xml";
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url === "https://acme.com/") {
        return response({
          text: `<html><head><link rel="alternate" type="application/rss+xml" href="${privateFeed}"></head></html>`,
        });
      }
      return response({ status: 404 });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    expect(result.changelog_rss).toBeNull();
    expect(fetchMock.mock.calls.every(([url]) => String(url) !== privateFeed)).toBe(true);
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
    expect(parseStringMock).not.toHaveBeenCalled();
  });

  it("never interpolates a rejected userinfo/private-IP domain into probe URLs", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      return response({ status: 404 });
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

// H-4/H-5: one run has to stay inside the BullMQ lock, and a probe whose miss is
// the expected outcome must not be retried into double the outbound volume.
describe("agents/discovery/competitor-discovery — runtime bounds", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    lookupMock.mockResolvedValue(PUBLIC_ANSWER);
    parseStringMock.mockRejectedValue(new Error("not a feed"));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("abandons a strategy still in flight at the run deadline and finalizes the rest", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url.startsWith("https://acme.com/pricing")) {
        return new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason));
        });
      }
      return response({ status: 404 });
    });

    const pending = discoverCompetitor(
      { competitor_id: "comp-1", name: "Acme", domain: "acme.com", existing: emptyExisting },
      { signal: controller.signal }
    );

    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/pricing"))).toBe(true)
    );
    controller.abort(Object.assign(new Error("deadline"), { name: "TimeoutError" }));

    const result = await pending;
    expect(logFor(result, "pricing_url")).toMatchObject({
      status: "error",
      error_message: "run deadline exceeded",
    });
    expect(logFor(result, "subreddits").status).toBe("found");
    expect(logFor(result, "greenhouse").status).toBe("not_found");
  });

  it("passes the run deadline into every probe so nothing outlives it", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      return response({ status: 404 });
    });

    await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    expect(fetchMock).toHaveBeenCalled();
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("does not retry a candidate that simply is not a feed", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      return response({ text: "<html>not a feed</html>" });
    });

    await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    const feedCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "https://acme.com/blog/rss"
    );
    expect(feedCalls).toHaveLength(1);
  });

  it("does not retry a 404 pricing probe", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      return response({ status: 404 });
    });

    await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    const pricingCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "https://acme.com/pricing"
    );
    expect(pricingCalls).toHaveLength(1);
  });

  it("retries reddit on a 5xx but takes a 4xx as the answer", async () => {
    const calls = new Map<string, number>();
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.includes("reddit.com")) return response({ status: 404 });
      calls.set(url, (calls.get(url) ?? 0) + 1);
      return response({ status: url.includes("type=sr") ? 503 : 429 });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    expect(logFor(result, "subreddits").status).toBe("error");
    expect([...calls.values()]).toEqual([2]);
  });
});

// H-1/H-2: the pre-fix guard was lexical only, so a hostname that merely looked
// public — or a redirect off one — reached private space.
describe("agents/discovery/competitor-discovery — SSRF guard", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    lookupMock.mockResolvedValue(PUBLIC_ANSWER);
    parseStringMock.mockRejectedValue(new Error("not a feed"));
    fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      return response({ status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["an attacker-controlled A record", "probe.attacker.com", "10.0.0.5"],
    ["a wildcard-DNS link-local host", "169.254.169.254.nip.io", "169.254.169.254"],
  ])("blocks %s and isolates it to the domain-based fields", async (_label, domain, address) => {
    lookupMock.mockImplementation(async (host: string) =>
      host === domain ? [{ address, family: 4 }] : PUBLIC_ANSWER
    );

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain,
      existing: emptyExisting,
    });

    for (const field of ["pricing_url", "rss_url"]) {
      expect(logFor(result, field)).toMatchObject({
        status: "error",
        error_message: "domain resolves to a non-public address",
      });
    }
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes(domain))).toBe(true);
    // reddit is a constant public host — its strategy is untouched.
    expect(logFor(result, "subreddits").status).toBe("found");
    expect(logFor(result, "greenhouse").status).toBe("not_found");
  });

  it("blocks a pricing redirect into the cloud metadata endpoint", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url === "https://acme.com/pricing") return redirect("http://169.254.169.254/latest/");
      return response({ status: 404 });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    expect(result.pricing_url).toBeNull();
    expect(logFor(result, "pricing_url")).toMatchObject({
      status: "error",
      error_message: "domain resolves to a non-public address",
    });
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("169.254"))).toBe(true);
  });

  it("does not persist a redirect target it could not re-validate", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url === "https://acme.com/pricing") return redirect("https://cdn.acme.com/pricing");
      if (url === "https://cdn.acme.com/pricing") return response();
      return response({ status: 404 });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    // The final URL is stored — but only after every hop passed the guard.
    expect(result.pricing_url).toBe("https://cdn.acme.com/pricing");
    expect(lookupMock).toHaveBeenCalledWith("cdn.acme.com", { all: true });
  });

  it("aborts an oversized homepage body instead of feeding it to cheerio", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("reddit.com")) return response({ json: { data: { children: [] } } });
      if (url === "https://acme.com/") return response({ text: "x".repeat(2_000_001) });
      return response({ status: 404 });
    });

    const result = await discoverCompetitor({
      competitor_id: "comp-1",
      name: "Acme",
      domain: "acme.com",
      existing: emptyExisting,
    });

    expect(logFor(result, "rss_url")).toMatchObject({
      status: "error",
      error_message: expect.stringContaining("exceeded 2000000 bytes"),
    });
  });
});
