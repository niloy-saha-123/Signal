import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));

const {
  listCompetitorsMock,
  getLatestSignalCollectedAtMock,
  signalExistsBySourceUrlMock,
  createSignalMock,
} = vi.hoisted(() => ({
  listCompetitorsMock: vi.fn(),
  getLatestSignalCollectedAtMock: vi.fn(),
  signalExistsBySourceUrlMock: vi.fn(),
  createSignalMock: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  getLatestSignalCollectedAt: getLatestSignalCollectedAtMock,
  signalExistsBySourceUrl: signalExistsBySourceUrlMock,
  createSignal: createSignalMock,
}));

const { registerWorkerMock } = vi.hoisted(() => ({ registerWorkerMock: vi.fn() }));
const { enqueueInitialSignalPipelineMock } = vi.hoisted(() => ({
  enqueueInitialSignalPipelineMock: vi.fn(),
}));

vi.mock("@/queues/registry", () => ({
  registerWorker: registerWorkerMock,
  queues: {},
}));
vi.mock("@/pipeline/recovery", () => ({
  enqueueInitialSignalPipeline: enqueueInitialSignalPipelineMock,
}));

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: safeFetchMock,
  assertPublicUrl: vi.fn().mockResolvedValue(undefined),
}));

// withRetry is exercised by its own suite — collapse it to a single call here
// so a deliberately-failing fetch in one test doesn't run three times.
vi.mock("@/lib/retry", () => ({
  withRetry: (fn: () => unknown) => fn(),
}));

import { githubCollectorProcessor } from "@/collectors/github";
import { isCircuitOpen, recordSuccess, recordFailure } from "@/reliability/circuit-breaker";
import type { Job } from "bullmq";

const job = {} as Job<Record<string, never>>;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    text: async () => JSON.stringify(body),
  };
}

const NOW = new Date("2026-09-25T00:00:00.000Z");
const RECENT = "2026-09-20T00:00:00.000Z";

function repo(overrides: Record<string, unknown> = {}) {
  return {
    name: "next",
    full_name: "acme/next",
    html_url: "https://github.com/acme/next",
    description: "The framework",
    fork: false,
    archived: false,
    private: false,
    pushed_at: RECENT,
    created_at: "2020-01-01T00:00:00.000Z",
    language: "TypeScript",
    stargazers_count: 100,
    ...overrides,
  };
}

// Routes each API path to a canned payload so a test only states the parts it
// cares about. Anything unrouted answers with an empty array, which is the
// real API's shape for the list endpoints.
function routeFetch(routes: Record<string, unknown>) {
  safeFetchMock.mockImplementation(async (url: string) => {
    for (const [fragment, body] of Object.entries(routes)) {
      if (url.includes(fragment)) return jsonResponse(body);
    }
    return jsonResponse([]);
  });
}

describe("github collector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.GITHUB_TOKEN = "test-token";
    listCompetitorsMock.mockResolvedValue([
      { id: "comp-1", name: "Acme", is_active: true, github_org: "acme" },
    ]);
    getLatestSignalCollectedAtMock.mockResolvedValue(undefined);
    signalExistsBySourceUrlMock.mockResolvedValue(false);
    createSignalMock.mockImplementation(async () => ({ id: "signal-1" }));
    vi.mocked(isCircuitOpen).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.GITHUB_TOKEN;
  });

  it("stores releases and pull requests as github signals and advances the pipeline", async () => {
    routeFetch({
      "/orgs/acme/repos": [repo()],
      "/releases": [
        {
          html_url: "https://github.com/acme/next/releases/tag/v15.0.0",
          tag_name: "v15.0.0",
          name: "Cache Components",
          body: "Introduces the new caching model.",
          draft: false,
          prerelease: false,
          published_at: RECENT,
        },
      ],
      "/pulls": [
        {
          html_url: "https://github.com/acme/next/pull/900",
          number: 900,
          title: "feat: native Postgres adapter",
          body: "Adds a first-party adapter.",
          state: "open",
          draft: false,
          created_at: RECENT,
          updated_at: RECENT,
          merged_at: null,
        },
      ],
    });

    await githubCollectorProcessor(job);

    const sources = createSignalMock.mock.calls.map(([arg]) => arg.source);
    expect(sources).toEqual(["github", "github"]);

    const urls = createSignalMock.mock.calls.map(([arg]) => arg.source_url);
    expect(urls).toContain("https://github.com/acme/next/releases/tag/v15.0.0");
    expect(urls).toContain("https://github.com/acme/next/pull/900");

    const pull = createSignalMock.mock.calls.find(([arg]) =>
      arg.source_url.includes("/pull/900")
    )?.[0];
    expect(pull.title).toBe("acme/next PR #900: feat: native Postgres adapter");
    expect(pull.raw_text).toContain("Adds a first-party adapter.");

    expect(enqueueInitialSignalPipelineMock).toHaveBeenCalledTimes(2);
    expect(recordSuccess).toHaveBeenCalledWith("github");
  });

  it("treats a repository created since the last run as a signal in its own right", async () => {
    getLatestSignalCollectedAtMock.mockResolvedValue(new Date("2026-09-01T00:00:00.000Z"));
    routeFetch({
      "/orgs/acme/repos": [repo({ created_at: "2026-09-10T00:00:00.000Z" })],
    });

    await githubCollectorProcessor(job);

    const created = createSignalMock.mock.calls.map(([arg]) => arg.title);
    expect(created).toContain("New repository: acme/next");
  });

  it("skips forks, archived repos, and repos with no push inside the staleness window", async () => {
    routeFetch({
      "/orgs/acme/repos": [
        repo({ name: "a", full_name: "acme/a", fork: true }),
        repo({ name: "b", full_name: "acme/b", archived: true }),
        repo({ name: "c", full_name: "acme/c", pushed_at: "2024-01-01T00:00:00.000Z" }),
      ],
    });

    await githubCollectorProcessor(job);

    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("does not re-store an artifact whose source_url is already collected", async () => {
    signalExistsBySourceUrlMock.mockResolvedValue(true);
    routeFetch({
      "/orgs/acme/repos": [repo()],
      "/releases": [
        {
          html_url: "https://github.com/acme/next/releases/tag/v15.0.0",
          tag_name: "v15.0.0",
          name: null,
          body: "notes",
          draft: false,
          prerelease: false,
          published_at: RECENT,
        },
      ],
    });

    await githubCollectorProcessor(job);

    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("ignores draft releases", async () => {
    routeFetch({
      "/orgs/acme/repos": [repo()],
      "/releases": [
        {
          html_url: "https://github.com/acme/next/releases/tag/v16.0.0",
          tag_name: "v16.0.0",
          name: "Unreleased",
          body: "not public yet",
          draft: true,
          prerelease: false,
          published_at: RECENT,
        },
      ],
    });

    await githubCollectorProcessor(job);

    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("ends the run on an exhausted rate limit without opening the circuit", async () => {
    // The limit resets on GitHub's clock. Opening the breaker on it would keep
    // the collector off GitHub well past the reset, for a quota we exceeded
    // rather than an outage.
    safeFetchMock.mockResolvedValue({
      status: 403,
      headers: new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790000000" }),
      text: async () => "",
    });

    await githubCollectorProcessor(job);

    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordSuccess).not.toHaveBeenCalled();
    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("records a failure for a competitor whose org returns an error, and keeps going", async () => {
    listCompetitorsMock.mockResolvedValue([
      { id: "comp-1", name: "Gone", is_active: true, github_org: "gone" },
      { id: "comp-2", name: "Acme", is_active: true, github_org: "acme" },
    ]);
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/orgs/gone/repos")) {
        return { status: 404, headers: new Headers(), text: async () => "" };
      }
      if (url.includes("/orgs/acme/repos")) return jsonResponse([repo()]);
      return jsonResponse([]);
    });

    await githubCollectorProcessor(job);

    expect(recordFailure).toHaveBeenCalledWith("github", expect.stringContaining("404"));
    // The healthy competitor was still swept — one bad org must not cost the rest.
    expect(safeFetchMock.mock.calls.some(([url]) => String(url).includes("/orgs/acme/repos"))).toBe(
      true
    );
    // A run with a failure in it never force-closes the breaker.
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("skips competitors with no github_org and inactive competitors", async () => {
    listCompetitorsMock.mockResolvedValue([
      { id: "comp-1", name: "NoOrg", is_active: true, github_org: null },
      { id: "comp-2", name: "Paused", is_active: false, github_org: "paused" },
    ]);
    routeFetch({});

    await githubCollectorProcessor(job);

    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("skips the run without failing the job when no GitHub token is configured", async () => {
    // An unset token is a deployment gap. Failing here would trip the breaker
    // against GitHub, which is working fine.
    delete process.env.GITHUB_TOKEN;

    await expect(githubCollectorProcessor(job)).resolves.toBeUndefined();

    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("throws when the circuit is already open", async () => {
    vi.mocked(isCircuitOpen).mockResolvedValue(true);

    await expect(githubCollectorProcessor(job)).rejects.toThrow(/circuit is open/);
  });

  it("sends the configured token so the run gets the authenticated rate limit", async () => {
    routeFetch({ "/orgs/acme/repos": [] });

    await githubCollectorProcessor(job);

    const [, init] = safeFetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-token");
  });
});
