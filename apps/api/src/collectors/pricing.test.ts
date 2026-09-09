import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../reliability/circuit-breaker", () => ({
  isCircuitOpen: vi.fn().mockResolvedValue(false),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
}));

const {
  listCompetitorsMock,
  getLatestPricingBaselineMock,
  createPricingBaselineMock,
  createPricingDiffMock,
  createSignalMock,
} = vi.hoisted(() => ({
  listCompetitorsMock: vi.fn(),
  getLatestPricingBaselineMock: vi.fn(),
  createPricingBaselineMock: vi.fn(),
  createPricingDiffMock: vi.fn(),
  createSignalMock: vi.fn(),
}));

vi.mock("../db/queries", () => ({
  listCompetitors: listCompetitorsMock,
  getLatestPricingBaseline: getLatestPricingBaselineMock,
  createPricingBaseline: createPricingBaselineMock,
  createPricingDiff: createPricingDiffMock,
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

// Fake Playwright surface — chromium.launch() must never touch a real browser
// in tests. newPageMock/gotoMock/evaluateMock/closeMock are shared across
// tests so each one can assert call shape and control the scraped text.
const { launchMock, newPageMock, setExtraHTTPHeadersMock, gotoMock, evaluateMock, closeMock } = vi.hoisted(
  () => ({
    launchMock: vi.fn(),
    newPageMock: vi.fn(),
    setExtraHTTPHeadersMock: vi.fn().mockResolvedValue(undefined),
    gotoMock: vi.fn().mockResolvedValue(undefined),
    evaluateMock: vi.fn(),
    closeMock: vi.fn().mockResolvedValue(undefined),
  })
);

vi.mock("playwright", () => ({
  chromium: { launch: launchMock },
}));

import { isCircuitOpen, recordFailure, recordSuccess } from "../reliability/circuit-breaker";
import { pricingCollectorProcessor, initPricingWorker } from "./pricing";

const competitorWithPricing = {
  id: "c1",
  name: "Acme",
  is_active: true,
  pricing_url: "https://acme.com/pricing",
};
const competitorWithoutPricing = {
  id: "c2",
  name: "Beta",
  is_active: true,
  pricing_url: null,
};
const inactiveCompetitor = {
  id: "c3",
  name: "Zeta",
  is_active: false,
  pricing_url: "https://zeta.com/pricing",
};

describe("collectors/pricing", () => {
  const originalEnv = process.env.ENABLE_PLAYWRIGHT;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_PLAYWRIGHT = "true";
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    listCompetitorsMock.mockResolvedValue([
      competitorWithPricing,
      competitorWithoutPricing,
      inactiveCompetitor,
    ]);
    getLatestPricingBaselineMock.mockResolvedValue(undefined);
    createPricingBaselineMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "b-new",
      ...input,
      captured_at: new Date(),
    }));
    createPricingDiffMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "d1",
      ...input,
    }));
    createSignalMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "s1",
      ...input,
    }));

    newPageMock.mockResolvedValue({
      setExtraHTTPHeaders: setExtraHTTPHeadersMock,
      goto: gotoMock,
      evaluate: evaluateMock,
    });
    launchMock.mockResolvedValue({ newPage: newPageMock, close: closeMock });
    // Re-set every test — vi.clearAllMocks() only clears call history, not a
    // persistent mockResolvedValue/mockRejectedValue implementation set by an
    // earlier test (e.g. the "closes the browser even when the scrape
    // throws" test's gotoMock.mockRejectedValue would otherwise leak into
    // every test that runs after it).
    setExtraHTTPHeadersMock.mockResolvedValue(undefined);
    gotoMock.mockResolvedValue(undefined);
    closeMock.mockResolvedValue(undefined);
    evaluateMock.mockResolvedValue("Pro plan $99/mo\nEnterprise: contact us");
  });

  afterEach(() => {
    process.env.ENABLE_PLAYWRIGHT = originalEnv;
  });

  it("no-ops the entire run without launching Playwright when ENABLE_PLAYWRIGHT is false", async () => {
    process.env.ENABLE_PLAYWRIGHT = "false";

    await expect(pricingCollectorProcessor({} as never)).resolves.toBeUndefined();

    expect(launchMock).not.toHaveBeenCalled();
    expect(listCompetitorsMock).not.toHaveBeenCalled();
  });

  it("short-circuits without launching Playwright when the pricing circuit is open", async () => {
    (isCircuitOpen as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await expect(pricingCollectorProcessor({} as never)).rejects.toThrow();

    expect(launchMock).not.toHaveBeenCalled();
    expect(listCompetitorsMock).not.toHaveBeenCalled();
  });

  it("skips competitors without a pricing_url and inactive competitors, without erroring", async () => {
    await pricingCollectorProcessor({} as never);

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(createPricingBaselineMock).toHaveBeenCalledTimes(1);
    expect(createPricingBaselineMock).toHaveBeenCalledWith(
      expect.objectContaining({ competitor_id: "c1" })
    );
  });

  it("scrapes via the mandatory Playwright pattern and always closes the browser", async () => {
    await pricingCollectorProcessor({} as never);

    expect(launchMock).toHaveBeenCalledWith({ headless: true });
    expect(setExtraHTTPHeadersMock).toHaveBeenCalledWith({
      "User-Agent": "Mozilla/5.0 (compatible; Signal/1.0; +https://signal.app)",
    });
    expect(gotoMock).toHaveBeenCalledWith("https://acme.com/pricing", {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    expect(evaluateMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("closes the browser even when the scrape throws", async () => {
    gotoMock.mockRejectedValue(new Error("nav timeout"));

    await pricingCollectorProcessor({} as never);

    // withRetry means goto is attempted multiple times, but a browser is
    // launched+closed exactly once per attempt — every launch must be
    // matched by a close, none left dangling.
    expect(launchMock.mock.calls.length).toBeGreaterThan(0);
    expect(closeMock.mock.calls.length).toBe(launchMock.mock.calls.length);
  }, 10000);

  it("first-ever scrape for a competitor inserts only a baseline — no diff, no signal", async () => {
    getLatestPricingBaselineMock.mockResolvedValue(undefined);

    await pricingCollectorProcessor({} as never);

    expect(createPricingBaselineMock).toHaveBeenCalledWith({
      competitor_id: "c1",
      snapshot: { raw_text: "Pro plan $99/mo\nEnterprise: contact us" },
    });
    expect(createPricingDiffMock).not.toHaveBeenCalled();
    expect(createSignalMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("an identical re-scrape (no textual change) inserts only the new baseline — no diff, no signal, no enqueue", async () => {
    // Scraped text matches the prior baseline's raw_text exactly (default
    // evaluateMock value from beforeEach) — the steady-state case for a
    // competitor whose pricing page hasn't changed.
    getLatestPricingBaselineMock.mockResolvedValue({
      id: "b-old",
      competitor_id: "c1",
      snapshot: { raw_text: "Pro plan $99/mo\nEnterprise: contact us" },
      captured_at: new Date("2026-08-01"),
    });

    await pricingCollectorProcessor({} as never);

    expect(createPricingBaselineMock).toHaveBeenCalledWith({
      competitor_id: "c1",
      snapshot: { raw_text: "Pro plan $99/mo\nEnterprise: contact us" },
    });
    expect(createPricingDiffMock).not.toHaveBeenCalled();
    expect(createSignalMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("computes a line-set diff, inserts a pricing_diffs row against the NEW baseline id, and enqueues entity extraction", async () => {
    getLatestPricingBaselineMock.mockResolvedValue({
      id: "b-old",
      competitor_id: "c1",
      snapshot: { raw_text: "Pro plan $99/mo\nStarter: free" },
      captured_at: new Date("2026-08-01"),
    });

    await pricingCollectorProcessor({} as never);

    expect(createPricingBaselineMock).toHaveBeenCalledWith({
      competitor_id: "c1",
      snapshot: { raw_text: "Pro plan $99/mo\nEnterprise: contact us" },
    });

    expect(createPricingDiffMock).toHaveBeenCalledTimes(1);
    const diffCall = createPricingDiffMock.mock.calls[0][0];
    expect(diffCall.competitor_id).toBe("c1");
    expect(diffCall.baseline_id).toBe("b-new");
    expect(diffCall.diff.added).toEqual(["Enterprise: contact us"]);
    expect(diffCall.diff.removed).toEqual(["Starter: free"]);

    expect(createSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitor_id: "c1",
        source: "pricing",
        source_url: "https://acme.com/pricing",
      })
    );
    const signalCall = createSignalMock.mock.calls[0][0];
    expect(typeof signalCall.raw_text).toBe("string");
    expect(signalCall.raw_text.length).toBeGreaterThan(0);

    expect(queueAddMock).toHaveBeenCalledWith(expect.any(String), { signal_id: "s1" });
  });

  it("classifies a diff touching a $ price line as at least moderate significance", async () => {
    getLatestPricingBaselineMock.mockResolvedValue({
      id: "b-old",
      competitor_id: "c1",
      snapshot: { raw_text: "Pro plan $99/mo" },
      captured_at: new Date("2026-08-01"),
    });
    evaluateMock.mockResolvedValue("Pro plan $149/mo");

    await pricingCollectorProcessor({} as never);

    const diffCall = createPricingDiffMock.mock.calls[0][0];
    expect(["moderate", "critical"]).toContain(diffCall.significance);
  });

  it("classifies a large-ratio rewrite as critical", async () => {
    getLatestPricingBaselineMock.mockResolvedValue({
      id: "b-old",
      competitor_id: "c1",
      snapshot: { raw_text: "line one\nline two" },
      captured_at: new Date("2026-08-01"),
    });
    evaluateMock.mockResolvedValue("totally different\nrewritten content\nwith $500 price");

    await pricingCollectorProcessor({} as never);

    const diffCall = createPricingDiffMock.mock.calls[0][0];
    expect(diffCall.significance).toBe("critical");
  });

  it("classifies a small non-price wording tweak as minor", async () => {
    // 40 lines with 1 changed = 2 changed lines / 40 = 0.05 change ratio,
    // clear of the 0.1 moderate threshold.
    getLatestPricingBaselineMock.mockResolvedValue({
      id: "b-old",
      competitor_id: "c1",
      snapshot: {
        raw_text: Array.from({ length: 40 }, (_, i) => `feature line ${i}`).join("\n"),
      },
      captured_at: new Date("2026-08-01"),
    });
    evaluateMock.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => `feature line ${i}`)
        .map((l, i) => (i === 0 ? "feature line 0 updated" : l))
        .join("\n")
    );

    await pricingCollectorProcessor({} as never);

    const diffCall = createPricingDiffMock.mock.calls[0][0];
    expect(diffCall.significance).toBe("minor");
  });

  it("isolates one competitor's failure so other competitors still get processed, and records circuit failure", async () => {
    const secondCompetitor = { id: "c4", name: "Gamma", is_active: true, pricing_url: "https://gamma.com/pricing" };
    listCompetitorsMock.mockResolvedValue([competitorWithPricing, secondCompetitor]);
    gotoMock.mockImplementation(async (url: string) => {
      if (url.includes("acme.com")) throw new Error("scrape failed");
    });

    await expect(pricingCollectorProcessor({} as never)).resolves.toBeUndefined();

    expect(createPricingBaselineMock).toHaveBeenCalledWith(
      expect.objectContaining({ competitor_id: "c4" })
    );
    expect(recordFailure).toHaveBeenCalledWith("pricing", expect.any(String));
    expect(recordSuccess).not.toHaveBeenCalled();
  }, 10000);

  it("records success after a clean run", async () => {
    await pricingCollectorProcessor({} as never);

    expect(recordSuccess).toHaveBeenCalledWith("pricing");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("stops attempting remaining competitors once the circuit trips mid-run", async () => {
    const secondCompetitor = { id: "c4", name: "Gamma", is_active: true, pricing_url: "https://gamma.com/pricing" };
    listCompetitorsMock.mockResolvedValue([competitorWithPricing, secondCompetitor]);
    (isCircuitOpen as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false) // initial job-level check
      .mockResolvedValueOnce(false) // before competitor 1
      .mockResolvedValueOnce(true); // before competitor 2 — breaks

    await pricingCollectorProcessor({} as never);

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(createPricingBaselineMock).toHaveBeenCalledTimes(1);
    expect(createPricingBaselineMock).toHaveBeenCalledWith(
      expect.objectContaining({ competitor_id: "c1" })
    );
    // Regression guard: a mid-run trip must not force-close a circuit that
    // was just correctly observed open (e.g. tripped by a concurrent run of
    // this same collector) — recordSuccess must not fire on this exit path,
    // even though every competitor actually attempted came back clean.
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("registers the collect-pricing worker via initPricingWorker without registering at import time", () => {
    expect(registerWorkerMock).not.toHaveBeenCalled();

    initPricingWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith("collect-pricing", pricingCollectorProcessor);
  });
});
