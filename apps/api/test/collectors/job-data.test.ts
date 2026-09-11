import { describe, expect, it } from "vitest";
import { CollectorJobDataSchema } from "@/collectors/job-data";

const competitorId = "11111111-1111-4111-8111-111111111111";

describe("CollectorJobDataSchema", () => {
  it("keeps scheduled collection's existing empty payload valid", () => {
    expect(CollectorJobDataSchema.parse({})).toEqual({});
  });

  it("accepts a bounded historical window for one competitor", () => {
    const data = {
      backfill: {
        competitor_id: competitorId,
        since: "2026-08-12T00:00:00.000Z",
        until: "2026-09-11T00:00:00.000Z",
      },
    };

    expect(CollectorJobDataSchema.parse(data)).toEqual(data);
  });

  it.each([
    {
      backfill: {
        competitor_id: "not-a-uuid",
        since: "2026-08-12T00:00:00.000Z",
        until: "2026-09-11T00:00:00.000Z",
      },
    },
    {
      backfill: {
        competitor_id: competitorId,
        since: "2026-09-12T00:00:00.000Z",
        until: "2026-09-11T00:00:00.000Z",
      },
    },
    {
      backfill: {
        competitor_id: competitorId,
        since: "2025-01-01T00:00:00.000Z",
        until: "2026-09-11T00:00:00.000Z",
      },
    },
    { unexpected: true },
  ])("rejects malformed, reversed, oversized, or unknown payloads %#", (data) => {
    expect(() => CollectorJobDataSchema.parse(data)).toThrow();
  });
});
