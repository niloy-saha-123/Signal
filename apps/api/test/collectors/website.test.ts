import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));

const { listCompetitorsMock, createChangeMock, getSnapshotMock, createSnapshotMock } = vi.hoisted(
  () => ({
    listCompetitorsMock: vi.fn(),
    createChangeMock: vi.fn(),
    getSnapshotMock: vi.fn(),
    createSnapshotMock: vi.fn(),
  })
);

vi.mock("@/db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  createWebsiteChangeSignal: createChangeMock,
  getLatestWebsiteSnapshot: getSnapshotMock,
  createWebsiteSnapshot: createSnapshotMock,
}));

vi.mock("@/queues/registry", () => ({ registerWorker: vi.fn(), queues: {} }));
vi.mock("@/pipeline/recovery", () => ({ enqueueInitialSignalPipeline: vi.fn() }));
vi.mock("@/lib/retry", () => ({ withRetry: (fn: () => unknown) => fn() }));

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: safeFetchMock,
  assertPublicUrl: vi.fn().mockResolvedValue(undefined),
}));

import { changedText, websiteCollectorProcessor } from "@/collectors/website";
import { recordFailure, recordSuccess } from "@/reliability/circuit-breaker";
import type { Job } from "bullmq";

const job = {} as Job<Record<string, never>>;

function page(body: string) {
  return {
    status: 200,
    headers: new Headers(),
    text: async () => `<html><body><nav>Menu</nav><main>${body}</main></body></html>`,
  };
}

const BEFORE =
  "Build faster with the developer platform trusted for production workloads. Deploy in seconds.";
const AFTER =
  "Build faster with the developer platform trusted for production workloads. Deploy in seconds. " +
  "Now with a fully managed Postgres database included on every plan at no extra cost for teams " +
  "moving their whole data layer onto the platform this year.";

describe("changedText", () => {
  it("returns the phrases that are new, not the whole page", () => {
    const added = changedText(BEFORE, AFTER);
    expect(added).toContain("managed Postgres database");
    expect(added).not.toContain("Deploy in seconds");
  });

  it("ignores punctuation-only rewrites", () => {
    expect(
      changedText("Fast secure global reliable deploys", "Fast, secure, global, reliable, deploys.")
    ).toBe("");
  });

  it("ignores stray single-word churn", () => {
    // A rotating word in a hero ("faster" -> "quicker") is not a positioning
    // change, and must not become a signal.
    expect(changedText("Build faster today", "Build quicker today")).toBe("");
  });

  it("returns nothing for identical text", () => {
    expect(changedText(BEFORE, BEFORE)).toBe("");
  });
});

describe("website collector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCompetitorsMock.mockResolvedValue([
      { id: "c1", name: "Kestrel", is_active: true, website_urls: ["https://kestrel.dev/"] },
    ]);
    createChangeMock.mockResolvedValue({ id: "s1" });
  });

  it("baselines a page on first sight instead of reporting it as a change", async () => {
    // Emitting the first snapshot would report a competitor's entire existing
    // homepage as news on day one.
    getSnapshotMock.mockResolvedValue(undefined);
    safeFetchMock.mockResolvedValue(page(BEFORE));

    await websiteCollectorProcessor(job);

    expect(createChangeMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("emits a website signal carrying only the new copy when the page really changed", async () => {
    getSnapshotMock.mockResolvedValue({ content: BEFORE, captured_at: new Date() });
    safeFetchMock.mockResolvedValue(page(AFTER));

    await websiteCollectorProcessor(job);

    expect(createChangeMock).toHaveBeenCalledTimes(1);
    const [signal, snapshot] = createChangeMock.mock.calls[0];
    expect(signal.source).toBe("website");
    expect(signal.raw_text).toContain("managed Postgres database");
    // One write for both: a snapshot that fails after the signal lands would
    // re-diff against the stale copy tomorrow and emit the same change twice.
    expect(snapshot).toMatchObject({ competitor_id: "c1", url: "https://kestrel.dev/" });
    expect(createSnapshotMock).not.toHaveBeenCalled();
  });

  it("re-baselines cosmetic churn without emitting a signal", async () => {
    getSnapshotMock.mockResolvedValue({ content: BEFORE, captured_at: new Date() });
    safeFetchMock.mockResolvedValue(page(BEFORE.replace("seconds", "moments")));

    await websiteCollectorProcessor(job);

    expect(createChangeMock).not.toHaveBeenCalled();
    // Without re-baselining, the same trivial diff is recomputed forever.
    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("skips competitors with no watched pages", async () => {
    listCompetitorsMock.mockResolvedValue([
      { id: "c1", name: "Kestrel", is_active: true, website_urls: [] },
    ]);

    await websiteCollectorProcessor(job);

    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("keeps words from adjacent blocks apart on minified pages", async () => {
    getSnapshotMock.mockResolvedValue(undefined);
    safeFetchMock.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: async () =>
        "<html><body><main><h1>Ship fast for teams</h1><p>Now with managed Postgres</p></main></body></html>",
    });

    await websiteCollectorProcessor(job);

    expect(createSnapshotMock.mock.calls[0][0].content).toBe(
      "Ship fast for teams Now with managed Postgres"
    );
  });

  it("trips the circuit when pages cannot be fetched, without skipping the rest", async () => {
    listCompetitorsMock.mockResolvedValue([
      {
        id: "c1",
        name: "Kestrel",
        is_active: true,
        website_urls: ["https://kestrel.dev/", "https://kestrel.dev/product"],
      },
    ]);
    getSnapshotMock.mockResolvedValue(undefined);
    safeFetchMock
      .mockRejectedValueOnce(new Error("403 from bot protection"))
      .mockResolvedValueOnce(page(BEFORE));

    await websiteCollectorProcessor(job);

    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalled();
    expect(recordSuccess).not.toHaveBeenCalled();
  });
});
