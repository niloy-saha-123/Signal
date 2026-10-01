import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  isCircuitMarkedOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));
const { listCompetitorsMock, existsMock, createSignalMock } = vi.hoisted(() => ({
  listCompetitorsMock: vi.fn(),
  existsMock: vi.fn(),
  createSignalMock: vi.fn(),
}));
vi.mock("@/db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  signalExistsBySourceUrl: existsMock,
  createSignal: createSignalMock,
}));
vi.mock("@/queues/registry", () => ({ registerWorker: vi.fn(), queues: {} }));
vi.mock("@/pipeline/recovery", () => ({ enqueueInitialSignalPipeline: vi.fn() }));
vi.mock("@/lib/retry", () => ({ withRetry: (fn: () => unknown) => fn() }));
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: safeFetchMock }));
const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: warnMock, error: vi.fn(), debug: vi.fn() },
}));

import { recordFailure, recordSuccess } from "@/reliability/circuit-breaker";
import { enqueueInitialSignalPipeline } from "@/pipeline/recovery";

import { stackoverflowCollectorProcessor, timing } from "@/collectors/stackoverflow";

const job = {} as any;
const json = (body: unknown, status = 200) => ({
  status,
  headers: new Headers(),
  json: async () => body,
});

const q = (over: Record<string, unknown> = {}) => ({
  question_id: 1,
  title: "What&#39;s new in Kestrel?",
  link: "https://stackoverflow.com/questions/1/whats-new",
  body: "<p>Hello <b>world</b></p>",
  score: 3,
  answer_count: 2,
  creation_date: Math.floor(Date.now() / 1000) - 3600,
  ...over,
});

describe("stackoverflow collector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.spyOn(timing, "sleep").mockResolvedValue(undefined);
    existsMock.mockResolvedValue(false);
    createSignalMock.mockImplementation(async (s: any) => ({ id: s.source_url }));
    listCompetitorsMock.mockResolvedValue([
      { id: "c1", name: "Kestrel", is_active: true, stackoverflow_tag: "kestrel" },
    ]);
  });

  it("does not fetch for a competitor without a tag", async () => {
    listCompetitorsMock.mockResolvedValue([{ id: "c1", name: "K", is_active: true, stackoverflow_tag: null }]);
    await stackoverflowCollectorProcessor(job);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("stores a question with decoded title and stripped body", async () => {
    safeFetchMock.mockResolvedValue(json({ items: [q()] }));
    await stackoverflowCollectorProcessor(job);
    expect(safeFetchMock.mock.calls[0][0]).toBe(
      "https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&tagged=kestrel&site=stackoverflow&pagesize=20&filter=withbody"
    );
    expect(createSignalMock.mock.calls[0][0]).toMatchObject({
      source: "community",
      source_url: "https://stackoverflow.com/questions/1/whats-new",
      title: "What's new in Kestrel?",
      raw_text:
        "Stack Overflow question tagged [kestrel] (score 3, 2 answers): What's new in Kestrel?\n\nHello world",
    });
  });

  it("drops an item whose link is not on stackoverflow.com", async () => {
    safeFetchMock.mockResolvedValue(json({ items: [q({ link: "https://evil.example/x" })] }));
    await stackoverflowCollectorProcessor(job);
    expect(createSignalMock).not.toHaveBeenCalled();
  });

  it("warns on backoff", async () => {
    safeFetchMock.mockResolvedValue(json({ items: [], backoff: 30 }));
    await stackoverflowCollectorProcessor(job);
    expect(warnMock).toHaveBeenCalled();
  });

  it("treats HTTP 400 bad_parameter as config: no failure", async () => {
    safeFetchMock.mockResolvedValue(json({ error_id: 400, error_name: "bad_parameter" }, 400));
    await stackoverflowCollectorProcessor(job);
    expect(warnMock).toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordSuccess).toHaveBeenCalledWith("stackoverflow");
  });

  it("charges the circuit on 503", async () => {
    safeFetchMock.mockResolvedValue(json({}, 503));
    await stackoverflowCollectorProcessor(job);
    expect(recordFailure).toHaveBeenCalledWith("stackoverflow", expect.any(String));
  });

  const two = [
    { id: "c1", name: "Kestrel", is_active: true, stackoverflow_tag: "kestrel" },
    { id: "c2", name: "Osprey", is_active: true, stackoverflow_tag: "osprey" },
  ];

  it("a 400 throttle_violation charges the circuit and stops the sweep", async () => {
    listCompetitorsMock.mockResolvedValue(two);
    safeFetchMock.mockResolvedValue(json({ error_id: 502, error_name: "throttle_violation" }, 400));
    await stackoverflowCollectorProcessor(job);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith("stackoverflow", expect.stringMatching(/502/));
  });

  it("honours backoff (capped at 60s) before the next request", async () => {
    listCompetitorsMock.mockResolvedValue(two);
    safeFetchMock.mockResolvedValueOnce(json({ items: [], backoff: 90 })).mockResolvedValueOnce(json({ items: [] }));
    await stackoverflowCollectorProcessor(job);
    expect(timing.sleep).toHaveBeenCalledTimes(1);
    expect(timing.sleep).toHaveBeenCalledWith(60);
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops the sweep when quota_remaining drops below 10", async () => {
    listCompetitorsMock.mockResolvedValue(two);
    safeFetchMock.mockResolvedValue(json({ items: [q()], quota_remaining: 5 }));
    await stackoverflowCollectorProcessor(job);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith("stackoverflow", expect.stringMatching(/quota/));
  });

  it("fetches each distinct tag once per run", async () => {
    listCompetitorsMock.mockResolvedValue([two[0], { ...two[1], stackoverflow_tag: "kestrel" }]);
    safeFetchMock.mockResolvedValue(json({ items: [q()] }));
    await stackoverflowCollectorProcessor(job);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(createSignalMock).toHaveBeenCalledTimes(2);
  });

  it("appends STACKEXCHANGE_KEY when set", async () => {
    vi.stubEnv("STACKEXCHANGE_KEY", "k&ey");
    safeFetchMock.mockResolvedValue(json({ items: [] }));
    await stackoverflowCollectorProcessor(job);
    expect(safeFetchMock.mock.calls[0][0]).toMatch(/&key=k%26ey$/);
  });

  it("skips questions older than 30 days", async () => {
    safeFetchMock.mockResolvedValue(
      json({ items: [q({ creation_date: Math.floor(Date.now() / 1000) - 40 * 86400 })] })
    );
    await stackoverflowCollectorProcessor(job);
    expect(createSignalMock).not.toHaveBeenCalled();
  });
});
