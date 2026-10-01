import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  isCircuitMarkedOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));
const { listCompetitorsMock, existsMock, createSignalMock, latestMock } = vi.hoisted(() => ({
  listCompetitorsMock: vi.fn(),
  existsMock: vi.fn(),
  createSignalMock: vi.fn(),
  latestMock: vi.fn(),
}));
vi.mock("@/db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  signalExistsBySourceUrl: existsMock,
  createSignal: createSignalMock,
  getLatestSignalCollectedAt: latestMock,
}));
vi.mock("@/queues/registry", () => ({ registerWorker: vi.fn(), queues: {} }));
vi.mock("@/pipeline/recovery", () => ({ enqueueInitialSignalPipeline: vi.fn() }));
vi.mock("@/lib/retry", () => ({ withRetry: (fn: () => unknown) => fn() }));
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: safeFetchMock }));
const { parseStringMock } = vi.hoisted(() => ({ parseStringMock: vi.fn() }));
vi.mock("rss-parser", () => ({
  default: class {
    parseString(body: string) {
      return parseStringMock(body);
    }
  },
}));

import { recordFailure, recordSuccess } from "@/reliability/circuit-breaker";
import { packagesCollectorProcessor } from "@/collectors/packages";

const job = {} as any;
const json = (body: unknown, status = 200) => ({
  status,
  headers: new Headers(),
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const rss = { status: 200, headers: new Headers(), text: async () => "<rss/>" };

function competitor(npm: string[], pypi: string[] = []) {
  return { id: "c1", name: "Kestrel", is_active: true, npm_packages: npm, pypi_packages: pypi };
}

describe("packages collector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsMock.mockResolvedValue(false);
    latestMock.mockResolvedValue(undefined);
    createSignalMock.mockImplementation(async (s: any) => ({ id: s.source_url }));
  });

  it("skips competitors with no packages configured", async () => {
    listCompetitorsMock.mockResolvedValue([competitor([], [])]);
    await packagesCollectorProcessor(job);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("emits a signal for a new npm latest, encoding scoped names", async () => {
    listCompetitorsMock.mockResolvedValue([competitor(["@kestrel/sdk"])]);
    safeFetchMock.mockResolvedValue(json({ latest: "2.4.0", next: "3.0.0-rc.1" }));

    await packagesCollectorProcessor(job);

    expect(safeFetchMock.mock.calls[0][0]).toBe(
      "https://registry.npmjs.org/-/package/@kestrel%2Fsdk/dist-tags"
    );
    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(createSignalMock.mock.calls[0][0]).toMatchObject({
      source: "packages",
      source_url: "https://www.npmjs.com/package/@kestrel/sdk/v/2.4.0",
      title: "@kestrel/sdk 2.4.0",
    });
  });

  it("does nothing when npm latest was already collected", async () => {
    listCompetitorsMock.mockResolvedValue([competitor(["kestrel"])]);
    safeFetchMock.mockResolvedValue(json({ latest: "2.4.0" }));
    existsMock.mockResolvedValue(true);

    await packagesCollectorProcessor(job);

    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("rejects a dist-tag that is not a plain version string", async () => {
    listCompetitorsMock.mockResolvedValue([competitor(["kestrel"])]);
    safeFetchMock.mockResolvedValue(json({ latest: "1.0.0/../../evil" }));

    await packagesCollectorProcessor(job);

    expect(createSignalMock).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalled();
  });

  it("on first run takes only the newest PyPI release", async () => {
    listCompetitorsMock.mockResolvedValue([competitor([], ["kestrel"])]);
    safeFetchMock.mockResolvedValue(rss);
    parseStringMock.mockResolvedValue({
      items: [
        { title: "2.0.0", link: "https://pypi.org/project/kestrel/2.0.0/", isoDate: "2026-09-30T00:00:00Z" },
        { title: "1.9.0", link: "https://pypi.org/project/kestrel/1.9.0/", isoDate: "2026-09-01T00:00:00Z" },
      ],
    });

    await packagesCollectorProcessor(job);

    expect(safeFetchMock.mock.calls[0][0]).toBe("https://pypi.org/rss/project/kestrel/releases.xml");
    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(createSignalMock.mock.calls[0][0]).toMatchObject({
      source_url: "https://pypi.org/project/kestrel/2.0.0/",
      title: "kestrel 2.0.0",
    });
  });

  it("after a prior signal takes every PyPI release newer than it", async () => {
    listCompetitorsMock.mockResolvedValue([competitor([], ["kestrel"])]);
    latestMock.mockResolvedValue(new Date("2026-09-10T00:00:00Z"));
    safeFetchMock.mockResolvedValue(rss);
    parseStringMock.mockResolvedValue({
      items: [
        { title: "2.0.0", link: "https://pypi.org/project/kestrel/2.0.0/", isoDate: "2026-09-30T00:00:00Z" },
        { title: "1.9.1", link: "https://pypi.org/project/kestrel/1.9.1/", isoDate: "2026-09-20T00:00:00Z" },
        { title: "1.9.0", link: "https://pypi.org/project/kestrel/1.9.0/", isoDate: "2026-09-01T00:00:00Z" },
      ],
    });

    await packagesCollectorProcessor(job);

    expect(createSignalMock.mock.calls.map((c) => c[0].title)).toEqual([
      "kestrel 2.0.0",
      "kestrel 1.9.1",
    ]);
  });

  it("skips a 404 package without charging the circuit and still collects the rest", async () => {
    listCompetitorsMock.mockResolvedValue([competitor(["kestrl-typo", "kestrel"])]);
    safeFetchMock
      .mockResolvedValueOnce(json({ error: "Not found" }, 404))
      .mockResolvedValueOnce(json({ latest: "1.0.0" }));

    await packagesCollectorProcessor(job);

    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordSuccess).toHaveBeenCalledWith("packages");
  });

  it("charges the circuit when a registry errors, after trying every package", async () => {
    listCompetitorsMock.mockResolvedValue([competitor(["a", "b"])]);
    safeFetchMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(json({ latest: "1.0.0" }));

    await packagesCollectorProcessor(job);

    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith("packages", expect.stringContaining("1 of 2"));
  });
});
