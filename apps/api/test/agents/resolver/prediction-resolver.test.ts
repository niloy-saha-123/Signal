import { describe, it, expect, vi, beforeEach } from "vitest";

const { listSignalsInWindowMock, listPricingDiffsInWindowMock } = vi.hoisted(() => ({
  listSignalsInWindowMock: vi.fn(),
  listPricingDiffsInWindowMock: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  listSignalsInWindow: listSignalsInWindowMock,
  listPricingDiffsInWindow: listPricingDiffsInWindowMock,
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

import { resolvePredictionCriteria } from "@/agents/resolver/prediction-resolver";

const CREATED_AT = new Date("2026-09-25T00:00:00.000Z");
const RESOLVES_AT = new Date("2026-12-24T00:00:00.000Z");
const AFTER_DUE = new Date("2026-12-25T00:00:00.000Z");

function prediction(criteria: unknown) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    competitor_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    created_at: CREATED_AT,
    resolves_at: RESOLVES_AT,
    resolution_criteria: criteria,
  } as Parameters<typeof resolvePredictionCriteria>[0];
}

function signal(overrides: Record<string, unknown> = {}) {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    source: "github",
    source_url: "https://github.com/acme/next/releases/tag/v15.0.0",
    title: "acme/next release: Postgres adapter",
    raw_text: "This release adds a first-party Postgres adapter.",
    collected_at: new Date("2026-11-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("resolvePredictionCriteria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSignalsInWindowMock.mockResolvedValue([]);
    listPricingDiffsInWindowMock.mockResolvedValue([]);
  });

  describe("signal_match", () => {
    const criteria = {
      kind: "signal_match",
      all_of: ["postgres", "adapter"],
      sources: ["github"],
    };

    it("hits when every term appears across the window's signals", async () => {
      listSignalsInWindowMock.mockResolvedValue([signal()]);

      const out = await resolvePredictionCriteria(prediction(criteria), AFTER_DUE);

      expect(out.status).toBe("hit");
      expect(out.evidence_urls).toContain("https://github.com/acme/next/releases/tag/v15.0.0");
    });

    it("does not hit when only some of the terms appear", async () => {
      // all_of, not any_of. A single common word matching is how a resolver
      // talks itself into a hit it did not earn.
      listSignalsInWindowMock.mockResolvedValue([
        signal({ raw_text: "This release adds a Postgres connection pooler.", title: "pooler" }),
      ]);

      const out = await resolvePredictionCriteria(prediction(criteria), AFTER_DUE);

      expect(out.status).not.toBe("hit");
    });

    it("matches case-insensitively", async () => {
      listSignalsInWindowMock.mockResolvedValue([
        signal({ raw_text: "Adds a first-party POSTGRES ADAPTER.", title: null }),
      ]);

      const out = await resolvePredictionCriteria(prediction(criteria), AFTER_DUE);

      expect(out.status).toBe("hit");
    });

    it("returns unresolved, not miss, when the window closed with no evidence at all", async () => {
      // A silent window is an absence of information, not a failed prediction.
      // Scoring it as a miss would make abstaining look identical to being wrong,
      // and would punish the system for competitors that simply went quiet.
      listSignalsInWindowMock.mockResolvedValue([]);

      const out = await resolvePredictionCriteria(prediction(criteria), AFTER_DUE);

      expect(out.status).toBe("unresolved");
      expect(out.evidence_urls).toEqual([]);
    });

    it("misses when the window carried real activity that did not match", async () => {
      // Evidence existed and disagreed — that is a genuine miss, and it has to
      // score, or the ledger only ever records wins.
      listSignalsInWindowMock.mockResolvedValue([
        signal({ raw_text: "Routine dependency bumps and CI fixes.", title: "chore" }),
        signal({ id: "e1", raw_text: "Docs typo fixes.", title: "docs" }),
        signal({ id: "e2", raw_text: "Refactor the logger.", title: "refactor" }),
      ]);

      const out = await resolvePredictionCriteria(prediction(criteria), AFTER_DUE);

      expect(out.status).toBe("miss");
    });

    it("only considers the sources the criteria named", async () => {
      await resolvePredictionCriteria(prediction(criteria), AFTER_DUE);

      const [, opts] = listSignalsInWindowMock.mock.calls[0];
      expect(opts.sources).toEqual(["github"]);
    });
  });

  describe("github_release", () => {
    const criteria = {
      kind: "github_release",
      repo: "acme/next",
      mentions: ["postgres"],
    };

    it("hits on a release from the named repo mentioning one of the terms", async () => {
      listSignalsInWindowMock.mockResolvedValue([signal()]);

      const out = await resolvePredictionCriteria(prediction(criteria), AFTER_DUE);

      expect(out.status).toBe("hit");
    });

    it("ignores a matching release from a different repository", async () => {
      listSignalsInWindowMock.mockResolvedValue([
        signal({
          source_url: "https://github.com/other/thing/releases/tag/v1.0.0",
          raw_text: "Adds a Postgres adapter.",
        }),
      ]);

      const out = await resolvePredictionCriteria(prediction(criteria), AFTER_DUE);

      expect(out.status).not.toBe("hit");
    });

    it("ignores a pull request even when it mentions the term", async () => {
      // A PR is intent; a release is the ship. The prediction said release.
      listSignalsInWindowMock.mockResolvedValue([
        signal({
          source_url: "https://github.com/acme/next/pull/900",
          raw_text: "Adds a Postgres adapter.",
        }),
      ]);

      const out = await resolvePredictionCriteria(prediction(criteria), AFTER_DUE);

      expect(out.status).not.toBe("hit");
    });
  });

  describe("pricing_change", () => {
    it("hits on an increase when the criteria asked for an increase", async () => {
      listPricingDiffsInWindowMock.mockResolvedValue([
        { id: "p1", diff: { direction: "increase" }, detected_at: new Date("2026-11-01T00:00:00.000Z") },
      ]);

      const out = await resolvePredictionCriteria(
        prediction({ kind: "pricing_change", direction: "increase" }),
        AFTER_DUE
      );

      expect(out.status).toBe("hit");
    });

    it("does not hit an increase when the criteria asked for a decrease", async () => {
      listPricingDiffsInWindowMock.mockResolvedValue([
        { id: "p1", diff: { direction: "increase" }, detected_at: new Date("2026-11-01T00:00:00.000Z") },
      ]);

      const out = await resolvePredictionCriteria(
        prediction({ kind: "pricing_change", direction: "decrease" }),
        AFTER_DUE
      );

      expect(out.status).toBe("miss");
    });

    it("hits any pricing movement when the criteria asked for any", async () => {
      listPricingDiffsInWindowMock.mockResolvedValue([
        { id: "p1", diff: { direction: "decrease" }, detected_at: new Date("2026-11-01T00:00:00.000Z") },
      ]);

      const out = await resolvePredictionCriteria(
        prediction({ kind: "pricing_change", direction: "any" }),
        AFTER_DUE
      );

      expect(out.status).toBe("hit");
    });

    it("returns unresolved when the pricing watcher recorded nothing in the window", async () => {
      // No diff means the watcher saw no change OR never ran. Those are not
      // distinguishable here, and calling it a miss would score the system on
      // its own collection gaps.
      listPricingDiffsInWindowMock.mockResolvedValue([]);

      const out = await resolvePredictionCriteria(
        prediction({ kind: "pricing_change", direction: "increase" }),
        AFTER_DUE
      );

      expect(out.status).toBe("unresolved");
    });
  });

  it("resolves early when the evidence already settles it before the due date", async () => {
    // A prediction proven true in week two should not sit open for another ten
    // weeks — the user needs the answer when it exists, not when the timer ends.
    listSignalsInWindowMock.mockResolvedValue([signal()]);

    const out = await resolvePredictionCriteria(
      prediction({ kind: "signal_match", all_of: ["postgres"], sources: ["github"] }),
      new Date("2026-11-02T00:00:00.000Z")
    );

    expect(out.status).toBe("hit");
  });

  it("never returns a verdict without a note explaining it", async () => {
    listSignalsInWindowMock.mockResolvedValue([signal()]);

    const out = await resolvePredictionCriteria(
      prediction({ kind: "signal_match", all_of: ["postgres"], sources: ["github"] }),
      AFTER_DUE
    );

    expect(out.note.length).toBeGreaterThan(0);
  });
});
