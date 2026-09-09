import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));

const { listCompetitorsMock, getLatestSignalCollectedAtMock, signalExistsBySourceUrlMock, createSignalMock } =
  vi.hoisted(() => ({
    listCompetitorsMock: vi.fn(),
    getLatestSignalCollectedAtMock: vi.fn(),
    signalExistsBySourceUrlMock: vi.fn(),
    createSignalMock: vi.fn(),
  }));

vi.mock("../db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  getLatestSignalCollectedAt: getLatestSignalCollectedAtMock,
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
import { hnCollectorProcessor, initHnWorker } from "./hn";

const activeCompetitor = { id: "c1", name: "Acme", is_active: true };
const inactiveCompetitor = { id: "c2", name: "Zeta", is_active: false };

function algoliaResponse(hits: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ hits }),
  };
}

describe("collectors/hn", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    listCompetitorsMock.mockResolvedValue([activeCompetitor, inactiveCompetitor]);
    getLatestSignalCollectedAtMock.mockResolvedValue(undefined);
    signalExistsBySourceUrlMock.mockResolvedValue(false);
    createSignalMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "s1",
      ...input,
    }));
    fetchMock = vi.fn().mockResolvedValue(algoliaResponse([]));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("short-circuits without hitting the network when the hn circuit is open", async () => {
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await expect(hnCollectorProcessor({} as never)).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(listCompetitorsMock).not.toHaveBeenCalled();
  });

  it("queries Algolia only for active competitors, by name", async () => {
    await hnCollectorProcessor({} as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("hn.algolia.com/api/v1/search");
    expect(url).toContain(`query=${encodeURIComponent("Acme")}`);
    expect(url).toContain("tags=comment");
    expect(url).not.toContain(encodeURIComponent("Zeta"));
  });

  it("uses a 7-day-ago window when no prior signal exists for this competitor+source", async () => {
    const before = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    await hnCollectorProcessor({} as never);

    const [url] = fetchMock.mock.calls[0];
    const match = url.match(/numericFilters=created_at_i>(\d+)/);
    expect(match).not.toBeNull();
    const since = Number(match![1]);
    expect(since).toBeGreaterThanOrEqual(before - 5);
    expect(since).toBeLessThanOrEqual(before + 5);
  });

  it("uses the last collected_at as the watermark when one exists", async () => {
    const lastCollectedAt = new Date("2026-08-01T00:00:00.000Z");
    getLatestSignalCollectedAtMock.mockResolvedValue(lastCollectedAt);

    await hnCollectorProcessor({} as never);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(`numericFilters=created_at_i>${Math.floor(lastCollectedAt.getTime() / 1000)}`);
  });

  it("inserts a new signal per hit, deduped by source_url, and enqueues entity extraction", async () => {
    fetchMock.mockResolvedValue(
      algoliaResponse([
        {
          objectID: "111",
          created_at_i: 1700000000,
          comment_text: "Acme just shipped a new feature",
          story_title: "Acme launches thing",
        },
      ])
    );

    await hnCollectorProcessor({} as never);

    expect(signalExistsBySourceUrlMock).toHaveBeenCalledWith(
      "c1",
      "hn",
      "https://news.ycombinator.com/item?id=111"
    );
    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitor_id: "c1",
        source: "hn",
        source_url: "https://news.ycombinator.com/item?id=111",
        title: "Acme launches thing",
        raw_text: "Acme just shipped a new feature",
      })
    );
    expect(queueAddMock).toHaveBeenCalledWith(expect.any(String), { signal_id: "s1" });
  });

  it("skips a hit whose source_url already exists for this competitor+source", async () => {
    fetchMock.mockResolvedValue(
      algoliaResponse([
        { objectID: "111", created_at_i: 1700000000, comment_text: "Acme mention" },
      ])
    );
    signalExistsBySourceUrlMock.mockResolvedValue(true);

    await hnCollectorProcessor({} as never);

    expect(createSignalMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("records success after a clean run, and records failure without throwing the whole job when a competitor's fetch keeps failing", async () => {
    await hnCollectorProcessor({} as never);
    expect(recordSuccess).toHaveBeenCalledWith("hn");
    expect(recordFailure).not.toHaveBeenCalled();

    vi.clearAllMocks();
    listCompetitorsMock.mockResolvedValue([activeCompetitor]);
    getLatestSignalCollectedAtMock.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    // A single failing competitor is isolated — it must not crash the whole
    // job (there's only one competitor here, so this also proves the job
    // resolves instead of rejecting).
    await expect(hnCollectorProcessor({} as never)).resolves.toBeUndefined();
    expect(recordFailure).toHaveBeenCalledWith("hn", expect.any(String));
    expect(recordSuccess).not.toHaveBeenCalled();
  }, 10000);

  it("keeps processing subsequent competitors when an earlier one's fetch keeps failing", async () => {
    const failingCompetitor = { id: "c-fail", name: "FailCo", is_active: true };
    listCompetitorsMock.mockResolvedValue([failingCompetitor, activeCompetitor]);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes(encodeURIComponent("FailCo"))) {
        throw new Error("network down");
      }
      return algoliaResponse([
        { objectID: "222", created_at_i: 1700000000, comment_text: "Acme mention" },
      ]);
    });

    await hnCollectorProcessor({} as never);

    // The healthy competitor after the failing one still got processed.
    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitor_id: "c1",
        source_url: "https://news.ycombinator.com/item?id=222",
      })
    );
    // The failing competitor's error was recorded against the circuit
    // breaker but did not stop the loop or reject the job.
    expect(recordFailure).toHaveBeenCalledWith("hn", expect.any(String));
    expect(recordSuccess).not.toHaveBeenCalled();
  }, 10000);

  it("sets a 30s abort timeout on the Algolia fetch", async () => {
    await hnCollectorProcessor({} as never);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps processing subsequent hits in the same competitor's batch when an earlier hit fails", async () => {
    fetchMock.mockResolvedValue(
      algoliaResponse([
        { objectID: "bad", created_at_i: 1700000000, comment_text: "bad hit" },
        { objectID: "good", created_at_i: 1700000000, comment_text: "good hit" },
      ])
    );
    createSignalMock
      .mockImplementationOnce(async () => {
        throw new Error("insert failed");
      })
      .mockImplementationOnce(async (input: Record<string, unknown>) => ({ id: "s2", ...input }));

    await hnCollectorProcessor({} as never);

    expect(createSignalMock).toHaveBeenCalledTimes(2);
    expect(queueAddMock).toHaveBeenCalledWith(expect.any(String), { signal_id: "s2" });
    // A single item's failure is logged and skipped — it's not a
    // competitor-level failure, so the run still records success.
    expect(recordSuccess).toHaveBeenCalledWith("hn");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("stops attempting remaining competitors once the circuit trips mid-run", async () => {
    const secondCompetitor = { id: "c2b", name: "Later", is_active: true };
    listCompetitorsMock.mockResolvedValue([activeCompetitor, secondCompetitor]);
    (isCircuitOpen as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false) // initial job-level check
      .mockResolvedValueOnce(false) // before competitor 1
      .mockResolvedValueOnce(true); // before competitor 2 — breaks

    await hnCollectorProcessor({} as never);

    const queries = fetchMock.mock.calls.filter((call: any[]) => call[0].includes("hn.algolia.com"));
    expect(queries).toHaveLength(1);
    expect(queries[0][0]).toContain(encodeURIComponent("Acme"));
  });

  it("registers the collect-hn worker via initHnWorker without registering at import time", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();

    initHnWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith("collect-hn", hnCollectorProcessor);
  });
});
