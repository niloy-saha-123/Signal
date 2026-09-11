import { describe, it, expect, afterEach, vi } from "vitest";

const { upsertJobSchedulerMock } = vi.hoisted(() => ({
  upsertJobSchedulerMock: vi.fn().mockResolvedValue({ id: "scheduled" }),
}));

// registry.ts is mocked with a QUEUE_CONFIG that differs from the real one
// (fewer collect-* queues than production) — if scheduler.ts derived its
// collector list from a hardcoded array instead of this import, the test
// below would still see the real 5 names and pass for the wrong reason.
vi.mock("./registry", () => ({
  COLLECTOR_RATE_LIMITER: { max: 10, duration: 60_000 },
  QUEUE_CONFIG: {
    "competitor-discovery": {},
    "company-profile-update": {},
    "collect-reddit": {},
    "collect-hn": {},
    "collect-jobs": {},
    "collect-changelog": {},
    "collect-pricing": {},
    "pipeline-entity-extraction": {},
    analysis: {},
  },
  queues: {
    "collect-reddit": { upsertJobScheduler: upsertJobSchedulerMock },
    "collect-hn": { upsertJobScheduler: upsertJobSchedulerMock },
    "collect-jobs": { upsertJobScheduler: upsertJobSchedulerMock },
    "collect-changelog": { upsertJobScheduler: upsertJobSchedulerMock },
    "collect-pricing": { upsertJobScheduler: upsertJobSchedulerMock },
  },
}));

import {
  COLLECTOR_QUEUE_NAMES,
  collectorCronExpression,
  getCollectIntervalHours,
  getCollectorScheduleConfig,
  registerCollectorSchedules,
  collectorSchedulerId,
} from "./scheduler";

describe("queues/scheduler", () => {
  const ORIGINAL_ENV = process.env.COLLECT_INTERVAL_HOURS;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.COLLECT_INTERVAL_HOURS;
    else process.env.COLLECT_INTERVAL_HOURS = ORIGINAL_ENV;
  });

  it("derives collector queue names from registry's QUEUE_CONFIG, not a hardcoded list", () => {
    expect(COLLECTOR_QUEUE_NAMES.slice().sort()).toEqual(
      ["collect-reddit", "collect-hn", "collect-jobs", "collect-changelog", "collect-pricing"].sort()
    );
  });

  it("defaults to 24 hours when COLLECT_INTERVAL_HOURS is unset", () => {
    delete process.env.COLLECT_INTERVAL_HOURS;
    expect(getCollectIntervalHours()).toBe(24);
  });

  it("falls back to 24 when COLLECT_INTERVAL_HOURS is not a valid positive number", () => {
    process.env.COLLECT_INTERVAL_HOURS = "not-a-number";
    expect(getCollectIntervalHours()).toBe(24);

    process.env.COLLECT_INTERVAL_HOURS = "-5";
    expect(getCollectIntervalHours()).toBe(24);

    process.env.COLLECT_INTERVAL_HOURS = "0";
    expect(getCollectIntervalHours()).toBe(24);
  });

  it("reads a valid COLLECT_INTERVAL_HOURS value straight through", () => {
    process.env.COLLECT_INTERVAL_HOURS = "6";
    expect(getCollectIntervalHours()).toBe(6);
  });

  it("produces a daily-at-midnight cron pattern for a 24 hour interval", () => {
    expect(collectorCronExpression(24)).toBe("0 0 * * *");
  });

  it("produces an hourly cron pattern for a 1 hour interval", () => {
    expect(collectorCronExpression(1)).toBe("0 * * * *");
  });

  it("produces an every-N-hours pattern for intervals under a day", () => {
    expect(collectorCronExpression(6)).toBe("0 */6 * * *");
  });

  it("produces a daily-at-midnight pattern for exactly 24 hours", () => {
    expect(collectorCronExpression(24)).toBe("0 0 * * *");
  });

  it("produces an every-N-days pattern for a multi-day interval that's a whole number of days", () => {
    expect(collectorCronExpression(48)).toBe("0 0 */2 * *");
    expect(collectorCronExpression(72)).toBe("0 0 */3 * *");
  });

  it("falls back to daily for a >24h interval that isn't a whole number of days (documented limitation)", () => {
    expect(collectorCronExpression(30)).toBe("0 0 * * *");
  });

  it("recomputes the cron expression from the current COLLECT_INTERVAL_HOURS env var when called with no argument", () => {
    process.env.COLLECT_INTERVAL_HOURS = "1";
    expect(collectorCronExpression()).toBe("0 * * * *");

    process.env.COLLECT_INTERVAL_HOURS = "24";
    expect(collectorCronExpression()).toBe("0 0 * * *");
  });

  it("applies each collector's own stub-sourced cadence when COLLECT_INTERVAL_HOURS is unset", () => {
    delete process.env.COLLECT_INTERVAL_HOURS;
    const config = getCollectorScheduleConfig();

    expect(Object.keys(config).sort()).toEqual(COLLECTOR_QUEUE_NAMES.slice().sort());
    // reddit/hn: 6h, jobs: 24h, changelog: 12h, pricing: 48h — per each
    // collector's own header-comment spec in collectors/*.ts.
    expect(config["collect-reddit"]?.repeat.pattern).toBe("0 */6 * * *");
    expect(config["collect-hn"]?.repeat.pattern).toBe("0 */6 * * *");
    expect(config["collect-jobs"]?.repeat.pattern).toBe("0 0 * * *");
    expect(config["collect-changelog"]?.repeat.pattern).toBe("0 */12 * * *");
    // 48h pricing must not collapse to the same daily pattern as jobs' 24h.
    expect(config["collect-pricing"]?.repeat.pattern).toBe("0 0 */2 * *");
    expect(config["collect-pricing"]?.repeat.pattern).not.toBe(config["collect-jobs"]?.repeat.pattern);
  });

  it("attaches a 10/minute rate limiter to every collect-* queue regardless of cadence", () => {
    delete process.env.COLLECT_INTERVAL_HOURS;
    const config = getCollectorScheduleConfig();
    for (const name of COLLECTOR_QUEUE_NAMES) {
      expect(config[name]?.limiter).toEqual({ max: 10, duration: 60_000 });
    }
  });

  it("overrides every collector's cadence uniformly when COLLECT_INTERVAL_HOURS is explicitly set", () => {
    process.env.COLLECT_INTERVAL_HOURS = "1";
    const config = getCollectorScheduleConfig();

    for (const name of COLLECTOR_QUEUE_NAMES) {
      expect(config[name]?.repeat.pattern).toBe("0 * * * *");
    }
  });

  it("ignores an invalid COLLECT_INTERVAL_HOURS override and falls back to per-queue defaults", () => {
    process.env.COLLECT_INTERVAL_HOURS = "not-a-number";
    const config = getCollectorScheduleConfig();

    expect(config["collect-reddit"]?.repeat.pattern).toBe("0 */6 * * *");
    expect(config["collect-jobs"]?.repeat.pattern).toBe("0 0 * * *");
  });

  it("has no schedule entry for competitor-discovery or company-profile-update", () => {
    const config = getCollectorScheduleConfig();
    expect(config["competitor-discovery"]).toBeUndefined();
    expect(config["company-profile-update"]).toBeUndefined();
  });

  it("idempotently upserts every collector under a stable scheduler id", async () => {
    delete process.env.COLLECT_INTERVAL_HOURS;
    upsertJobSchedulerMock.mockClear();

    await registerCollectorSchedules();

    expect(upsertJobSchedulerMock).toHaveBeenCalledTimes(5);
    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      collectorSchedulerId("collect-reddit"),
      { pattern: "0 */6 * * *" },
      { name: "collect-reddit", data: {} }
    );
    expect(collectorSchedulerId("collect-pricing")).toBe("signal:collector:collect-pricing:v1");
  });
});
