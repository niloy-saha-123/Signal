import { describe, expect, it, vi } from "vitest";
import { planBackfill, runBackfill, type BackfillDeps } from "../../scripts/backfill";

const competitorId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-09-11T15:30:00.000Z");

function dependencies(overrides: Partial<BackfillDeps> = {}): BackfillDeps {
  return {
    getCompetitorById: vi.fn(async () => ({ id: competitorId, is_active: true })),
    addRedditJob: vi.fn(async () => undefined),
    addHnJob: vi.fn(async () => undefined),
    now: () => now,
    ...overrides,
  };
}

describe("backfill", () => {
  it("plans a UTC window and stable BullMQ IDs for Reddit and HN", () => {
    expect(
      planBackfill(
        {
          competitor_id: competitorId,
          days: 30,
          sources: ["reddit", "hn"],
          dry_run: false,
        },
        now
      )
    ).toEqual({
      competitor_id: competitorId,
      since: "2026-08-12T15:30:00.000Z",
      until: "2026-09-11T15:30:00.000Z",
      jobs: [
        {
          source: "reddit",
          queue: "collect-reddit",
          job_id: `backfill-reddit-${competitorId}-2026-08-12-2026-09-11`,
        },
        {
          source: "hn",
          queue: "collect-hn",
          job_id: `backfill-hn-${competitorId}-2026-08-12-2026-09-11`,
        },
      ],
      dry_run: false,
    });
  });

  it("validates the competitor and enqueues immutable scoped jobs", async () => {
    const deps = dependencies();

    const result = await runBackfill(
      [`--competitor-id=${competitorId}`, "--days=30"],
      deps
    );

    expect(deps.getCompetitorById).toHaveBeenCalledWith(competitorId);
    expect(deps.addRedditJob).toHaveBeenCalledWith(
      "backfill",
      {
        backfill: {
          competitor_id: competitorId,
          since: "2026-08-12T15:30:00.000Z",
          until: "2026-09-11T15:30:00.000Z",
        },
      },
      { jobId: `backfill-reddit-${competitorId}-2026-08-12-2026-09-11` }
    );
    expect(deps.addHnJob).toHaveBeenCalledOnce();
    expect(result.jobs).toHaveLength(2);
  });

  it("supports a source subset and dry-run without touching Redis", async () => {
    const deps = dependencies();

    const result = await runBackfill(
      [
        `--competitor-id=${competitorId}`,
        "--days=7",
        "--sources=hn",
        "--dry-run=true",
      ],
      deps
    );

    expect(result.jobs.map((job) => job.source)).toEqual(["hn"]);
    expect(result.dry_run).toBe(true);
    expect(deps.addRedditJob).not.toHaveBeenCalled();
    expect(deps.addHnJob).not.toHaveBeenCalled();
  });

  it.each([
    ["--days=0", "greater than or equal to 1"],
    ["--days=366", "less than or equal to 365"],
    ["--sources=jobs", "Unsupported backfill source"],
    ["--sources=reddit,reddit", "Duplicate backfill source"],
  ])("rejects invalid bounded options: %s", async (option, message) => {
    const deps = dependencies();
    await expect(
      runBackfill([`--competitor-id=${competitorId}`, option], deps)
    ).rejects.toThrow(message);
    expect(deps.getCompetitorById).not.toHaveBeenCalled();
  });

  it("rejects a missing or inactive competitor before enqueueing", async () => {
    const missing = dependencies({ getCompetitorById: vi.fn(async () => undefined) });
    await expect(
      runBackfill([`--competitor-id=${competitorId}`], missing)
    ).rejects.toThrow("not found");

    const inactive = dependencies({
      getCompetitorById: vi.fn(async () => ({ id: competitorId, is_active: false })),
    });
    await expect(
      runBackfill([`--competitor-id=${competitorId}`], inactive)
    ).rejects.toThrow("inactive");
    expect(inactive.addRedditJob).not.toHaveBeenCalled();
    expect(inactive.addHnJob).not.toHaveBeenCalled();
  });

  it("surfaces an enqueue failure so a rerun can reuse stable job IDs", async () => {
    const deps = dependencies({
      addHnJob: vi.fn(async () => {
        throw new Error("Redis unavailable");
      }),
    });

    await expect(
      runBackfill([`--competitor-id=${competitorId}`], deps)
    ).rejects.toThrow("Redis unavailable");
  });

  it("reuses the same BullMQ job IDs when an operator repeats a request", async () => {
    const deps = dependencies();
    const argv = [`--competitor-id=${competitorId}`, "--days=30"];

    await runBackfill(argv, deps);
    await runBackfill(argv, deps);

    expect(deps.addRedditJob).toHaveBeenNthCalledWith(
      1,
      "backfill",
      expect.any(Object),
      { jobId: `backfill-reddit-${competitorId}-2026-08-12-2026-09-11` }
    );
    expect(deps.addRedditJob).toHaveBeenNthCalledWith(
      2,
      "backfill",
      expect.any(Object),
      { jobId: `backfill-reddit-${competitorId}-2026-08-12-2026-09-11` }
    );
  });
});
