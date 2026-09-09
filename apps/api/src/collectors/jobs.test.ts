import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));

const { listCompetitorsMock, signalExistsBySourceUrlMock, createSignalMock } = vi.hoisted(() => ({
  listCompetitorsMock: vi.fn(),
  signalExistsBySourceUrlMock: vi.fn(),
  createSignalMock: vi.fn(),
}));

vi.mock("../db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  signalExistsBySourceUrl: signalExistsBySourceUrlMock,
  createSignal: createSignalMock,
}));

const { queueAddMock, registerWorkerMock } = vi.hoisted(() => ({
  queueAddMock: vi.fn().mockResolvedValue(undefined),
  registerWorkerMock: vi.fn(),
}));

vi.mock("../queues/registry", () => ({
  registerWorker: registerWorkerMock,
  queues: { "pipeline-entity-extraction": { add: queueAddMock } },
}));

import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { jobsCollectorProcessor, initJobsWorker } from "./jobs";

const bothTokensCompetitor = {
  id: "c1",
  name: "Acme",
  is_active: true,
  greenhouse_token: "acme-gh",
  lever_token: "acme-lv",
};
const greenhouseOnlyCompetitor = {
  id: "c2",
  name: "GhOnly",
  is_active: true,
  greenhouse_token: "gh-only",
  lever_token: null,
};
const leverOnlyCompetitor = {
  id: "c3",
  name: "LvOnly",
  is_active: true,
  greenhouse_token: null,
  lever_token: "lv-only",
};
const neitherCompetitor = {
  id: "c4",
  name: "Neither",
  is_active: true,
  greenhouse_token: null,
  lever_token: null,
};
const inactiveCompetitor = {
  id: "c5",
  name: "Inactive",
  is_active: false,
  greenhouse_token: "inactive-gh",
  lever_token: "inactive-lv",
};

function greenhouseResponse(jobs: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ jobs }) };
}

function leverResponse(postings: unknown[]) {
  return { ok: true, status: 200, json: async () => postings };
}

function isCircuitOpenMock() {
  return isCircuitOpen as ReturnType<typeof vi.fn>;
}

describe("collectors/jobs", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    isCircuitOpenMock().mockResolvedValue(false);
    listCompetitorsMock.mockResolvedValue([bothTokensCompetitor]);
    signalExistsBySourceUrlMock.mockResolvedValue(false);
    createSignalMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "s1",
      ...input,
    }));
    fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("boards-api.greenhouse.io")) return greenhouseResponse([]);
      if (url.includes("api.lever.co")) return leverResponse([]);
      throw new Error(`unexpected fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("short-circuits without hitting the network when both circuits are open", async () => {
    isCircuitOpenMock().mockResolvedValue(true);

    await expect(jobsCollectorProcessor({} as never)).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(listCompetitorsMock).not.toHaveBeenCalled();
  });

  it("still collects Lever when only the greenhouse circuit is open", async () => {
    isCircuitOpenMock().mockImplementation(async (service: string) => service === "greenhouse");
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("api.lever.co")) {
        return leverResponse([
          { id: "lv1", text: "Lever Job", hostedUrl: "https://jobs.lever.co/acme-lv/lv1", createdAt: 1700000000000 },
        ]);
      }
      throw new Error(`unexpected fetch url when greenhouse circuit is open: ${url}`);
    });

    await jobsCollectorProcessor({} as never);

    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ source_url: "https://jobs.lever.co/acme-lv/lv1" })
    );
  });

  it("still collects Greenhouse when only the lever circuit is open", async () => {
    isCircuitOpenMock().mockImplementation(async (service: string) => service === "lever");
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("boards-api.greenhouse.io")) {
        return greenhouseResponse([
          {
            id: 1,
            title: "Greenhouse Job",
            absolute_url: "https://acme.com/jobs/1",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ]);
      }
      throw new Error(`unexpected fetch url when lever circuit is open: ${url}`);
    });

    await jobsCollectorProcessor({} as never);

    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ source_url: "https://acme.com/jobs/1" })
    );
  });

  it("skips competitors with neither token, and inactive competitors, without erroring", async () => {
    listCompetitorsMock.mockResolvedValue([neitherCompetitor, inactiveCompetitor]);

    await expect(jobsCollectorProcessor({} as never)).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("only fetches Greenhouse for a competitor with only a greenhouse_token", async () => {
    listCompetitorsMock.mockResolvedValue([greenhouseOnlyCompetitor]);

    await jobsCollectorProcessor({} as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://boards-api.greenhouse.io/v1/boards/gh-only/jobs");
  });

  it("only fetches Lever for a competitor with only a lever_token", async () => {
    listCompetitorsMock.mockResolvedValue([leverOnlyCompetitor]);

    await jobsCollectorProcessor({} as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lever.co/v0/postings/lv-only?mode=json");
  });

  it("fetches both Greenhouse and Lever for a competitor with both tokens set", async () => {
    await jobsCollectorProcessor({} as never);

    const urls = fetchMock.mock.calls.map((call: any[]) => call[0]);
    expect(urls).toContain("https://boards-api.greenhouse.io/v1/boards/acme-gh/jobs");
    expect(urls).toContain("https://api.lever.co/v0/postings/acme-lv?mode=json");
  });

  it("inserts a jobs signal per Greenhouse posting, deduped by source_url, and enqueues entity extraction", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("boards-api.greenhouse.io")) {
        return greenhouseResponse([
          {
            id: 42,
            title: "Senior Engineer",
            absolute_url: "https://acme.com/jobs/42",
            updated_at: "2026-01-01T00:00:00Z",
            content: "<p>Join Acme</p>",
          },
        ]);
      }
      return leverResponse([]);
    });

    await jobsCollectorProcessor({} as never);

    expect(signalExistsBySourceUrlMock).toHaveBeenCalledWith("c1", "jobs", "https://acme.com/jobs/42");
    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitor_id: "c1",
        source: "jobs",
        source_url: "https://acme.com/jobs/42",
        title: "Senior Engineer",
        raw_text: "Join Acme",
      })
    );
    expect(queueAddMock).toHaveBeenCalledWith(expect.any(String), { signal_id: "s1" });
  });

  it("strips HTML from Greenhouse's content field before storing raw_text", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("boards-api.greenhouse.io")) {
        return greenhouseResponse([
          {
            id: 7,
            title: "Backend Engineer",
            absolute_url: "https://acme.com/jobs/7",
            content: "<div><p>We are <strong>hiring</strong>!</p><ul><li>Node.js</li></ul></div>",
          },
        ]);
      }
      return leverResponse([]);
    });

    await jobsCollectorProcessor({} as never);

    const call = createSignalMock.mock.calls.find(
      (c: any[]) => c[0].source_url === "https://acme.com/jobs/7"
    );
    expect(call![0].raw_text).not.toMatch(/<[^>]+>/);
    expect(call![0].raw_text).toContain("We are hiring!");
    expect(call![0].raw_text).toContain("Node.js");
  });

  it("inserts a jobs signal per Lever posting, deduped by source_url, and enqueues entity extraction", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("api.lever.co")) {
        return leverResponse([
          {
            id: "abc",
            text: "Staff Engineer",
            hostedUrl: "https://jobs.lever.co/acme-lv/abc",
            createdAt: 1700000000000,
            descriptionPlain: "Join Acme as Staff Engineer",
          },
        ]);
      }
      return greenhouseResponse([]);
    });

    await jobsCollectorProcessor({} as never);

    expect(signalExistsBySourceUrlMock).toHaveBeenCalledWith(
      "c1",
      "jobs",
      "https://jobs.lever.co/acme-lv/abc"
    );
    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitor_id: "c1",
        source: "jobs",
        source_url: "https://jobs.lever.co/acme-lv/abc",
        title: "Staff Engineer",
        raw_text: "Join Acme as Staff Engineer",
      })
    );
    expect(queueAddMock).toHaveBeenCalledWith(expect.any(String), { signal_id: "s1" });
  });

  it("skips a posting whose source_url already exists for this competitor+source", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("boards-api.greenhouse.io")) {
        return greenhouseResponse([
          { id: 1, title: "Job", absolute_url: "https://acme.com/jobs/1", updated_at: "2026-01-01T00:00:00Z" },
        ]);
      }
      return leverResponse([]);
    });
    signalExistsBySourceUrlMock.mockResolvedValue(true);

    await jobsCollectorProcessor({} as never);

    expect(createSignalMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("a Greenhouse failure for one competitor does not block that same competitor's Lever collection", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("boards-api.greenhouse.io")) {
        throw new Error("greenhouse network down");
      }
      if (url.includes("api.lever.co")) {
        return leverResponse([
          { id: "lv1", text: "Lever Job", hostedUrl: "https://jobs.lever.co/acme-lv/lv1", createdAt: 1700000000000 },
        ]);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    await expect(jobsCollectorProcessor({} as never)).resolves.toBeUndefined();

    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ source_url: "https://jobs.lever.co/acme-lv/lv1" })
    );
    expect(recordFailure).toHaveBeenCalledWith("greenhouse", expect.any(String));
  }, 10000);

  it("a Lever failure for one competitor does not block that same competitor's Greenhouse collection", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("api.lever.co")) {
        throw new Error("lever network down");
      }
      if (url.includes("boards-api.greenhouse.io")) {
        return greenhouseResponse([
          { id: 1, title: "Job", absolute_url: "https://acme.com/jobs/1", updated_at: "2026-01-01T00:00:00Z" },
        ]);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    await expect(jobsCollectorProcessor({} as never)).resolves.toBeUndefined();

    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ source_url: "https://acme.com/jobs/1" })
    );
    expect(recordFailure).toHaveBeenCalledWith("lever", expect.any(String));
  }, 10000);

  it("a Greenhouse failure for one competitor does not block Greenhouse collection for the next competitor", async () => {
    const failingCompetitor = {
      id: "c-fail",
      name: "FailCo",
      is_active: true,
      greenhouse_token: "fail-gh",
      lever_token: null,
    };
    listCompetitorsMock.mockResolvedValue([failingCompetitor, greenhouseOnlyCompetitor]);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/boards/fail-gh/")) throw new Error("network down");
      if (url.includes("/boards/gh-only/")) {
        return greenhouseResponse([
          { id: 9, title: "Ok Job", absolute_url: "https://ghonly.com/jobs/9", updated_at: "2026-01-01T00:00:00Z" },
        ]);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    await jobsCollectorProcessor({} as never);

    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ competitor_id: "c2", source_url: "https://ghonly.com/jobs/9" })
    );
    expect(recordFailure).toHaveBeenCalledWith("greenhouse", expect.any(String));
  }, 10000);

  it("records success per-service after a clean run", async () => {
    await jobsCollectorProcessor({} as never);

    expect(recordSuccess).toHaveBeenCalledWith("greenhouse");
    expect(recordSuccess).toHaveBeenCalledWith("lever");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("records greenhouse success but not lever success when only greenhouse ran cleanly and lever kept failing", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("boards-api.greenhouse.io")) return greenhouseResponse([]);
      if (url.includes("api.lever.co")) throw new Error("lever down");
      throw new Error(`unexpected url: ${url}`);
    });

    await jobsCollectorProcessor({} as never);

    expect(recordSuccess).toHaveBeenCalledWith("greenhouse");
    expect(recordSuccess).not.toHaveBeenCalledWith("lever");
    expect(recordFailure).toHaveBeenCalledWith("lever", expect.any(String));
  }, 10000);

  it("sets a 30s abort timeout on Greenhouse and Lever fetches", async () => {
    await jobsCollectorProcessor({} as never);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchMock.mock.calls) {
      const [, options] = call;
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("stops attempting Greenhouse for remaining competitors once the greenhouse circuit trips mid-run, without affecting Lever", async () => {
    const secondGhCompetitor = {
      id: "c2z",
      name: "SecondGh",
      is_active: true,
      greenhouse_token: "second-gh",
      lever_token: null,
    };
    // bothTokensCompetitor first so its Lever collection runs and succeeds
    // this pass — proves a greenhouse trip doesn't stop lever's own
    // recordSuccess from firing.
    listCompetitorsMock.mockResolvedValue([bothTokensCompetitor, secondGhCompetitor]);

    let greenhouseCallCount = 0;
    isCircuitOpenMock().mockImplementation(async (service: string) => {
      if (service !== "greenhouse") return false;
      greenhouseCallCount += 1;
      // 1st call: initial job-level check. 2nd: before competitor 1. 3rd:
      // before competitor 2 — trips here.
      return greenhouseCallCount >= 3;
    });

    await jobsCollectorProcessor({} as never);

    const urls = fetchMock.mock.calls.map((c: any[]) => c[0]);
    expect(urls).toContain("https://boards-api.greenhouse.io/v1/boards/acme-gh/jobs");
    expect(urls).not.toContain("https://boards-api.greenhouse.io/v1/boards/second-gh/jobs");

    // Regression guard: this run's own greenhouse attempt (competitor 1)
    // came back clean, but the loop still exited via a mid-run trip — that
    // must not force-close a circuit that was just correctly observed open
    // (e.g. tripped by a concurrent run of this same collector). Lever's own
    // circuit was never observed open, so its recordSuccess is unaffected.
    expect(recordSuccess).not.toHaveBeenCalledWith("greenhouse");
    expect(recordSuccess).toHaveBeenCalledWith("lever");
  });

  it("registers the collect-jobs worker via initJobsWorker without registering at import time", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();

    initJobsWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith("collect-jobs", jobsCollectorProcessor);
  });
});
