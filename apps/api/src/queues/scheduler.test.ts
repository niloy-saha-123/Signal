import { describe, it, expect, afterEach, vi } from "vitest";

// registry.ts is mocked with a QUEUE_CONFIG that differs from the real one
// (fewer collect-* queues than production) — if scheduler.ts derived its
// collector list from a hardcoded array instead of this import, the test
// below would still see the real 5 names and pass for the wrong reason.
vi.mock("./registry", () => ({
  QUEUE_CONFIG: {
    "competitor-discovery": {},
    "company-profile-update": {},
    "collect-reddit": {},
    "collect-hn": {},
    "pipeline-entity-extraction": {},
    analysis: {},
  },
}));

import {
  COLLECTOR_QUEUE_NAMES,
  collectorCronExpression,
  getCollectIntervalHours,
  getCollectorScheduleConfig,
} from "./scheduler";

describe("queues/scheduler", () => {
  const ORIGINAL_ENV = process.env.COLLECT_INTERVAL_HOURS;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.COLLECT_INTERVAL_HOURS;
    else process.env.COLLECT_INTERVAL_HOURS = ORIGINAL_ENV;
  });

  it("derives collector queue names from registry's QUEUE_CONFIG, not a hardcoded list", () => {
    expect(COLLECTOR_QUEUE_NAMES.slice().sort()).toEqual(["collect-hn", "collect-reddit"].sort());
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

  it("treats any interval of 24 hours or more as once daily", () => {
    expect(collectorCronExpression(48)).toBe("0 0 * * *");
  });

  it("recomputes the cron expression from the current COLLECT_INTERVAL_HOURS env var when called with no argument", () => {
    process.env.COLLECT_INTERVAL_HOURS = "1";
    expect(collectorCronExpression()).toBe("0 * * * *");

    process.env.COLLECT_INTERVAL_HOURS = "24";
    expect(collectorCronExpression()).toBe("0 0 * * *");
  });

  it("attaches a repeat pattern and a 10/minute rate limiter to every collect-* queue", () => {
    process.env.COLLECT_INTERVAL_HOURS = "24";
    const config = getCollectorScheduleConfig();

    expect(Object.keys(config).sort()).toEqual(COLLECTOR_QUEUE_NAMES.slice().sort());
    for (const name of COLLECTOR_QUEUE_NAMES) {
      expect(config[name]).toEqual({
        repeat: { pattern: "0 0 * * *" },
        limiter: { max: 10, duration: 60_000 },
      });
    }
  });

  it("has no schedule entry for competitor-discovery or company-profile-update", () => {
    const config = getCollectorScheduleConfig();
    expect(config["competitor-discovery"]).toBeUndefined();
    expect(config["company-profile-update"]).toBeUndefined();
  });
});
