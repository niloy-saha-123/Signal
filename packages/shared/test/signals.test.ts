import { describe, it, expect } from "vitest";
import {
  SignalSchema,
  SignalClusterSchema,
  SignalScoreSchema,
  CompetitorDiscoveryResultSchema,
} from "../src/signals";

describe("SignalSchema", () => {
  it("accepts a valid signal", () => {
    const result = SignalSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      competitor_id: "550e8400-e29b-41d4-a716-446655440001",
      source: "reddit",
      source_url: "https://reddit.com/r/saas/comments/abc123",
      title: "Users complaining about pricing",
      raw_text: "Just switched away from Acme because of the price hike.",
      quality_score: 0.72,
      entities: { prices: ["$49/mo"], products: [] },
      cluster_id: null,
      collected_at: "2026-09-01T00:00:00.000Z",
      created_at: "2026-09-01T00:00:01.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a source outside the DB CHECK constraint's allowed values", () => {
    const result = SignalSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      competitor_id: "550e8400-e29b-41d4-a716-446655440001",
      source: "twitter",
      raw_text: "text",
      quality_score: 0.5,
      collected_at: "2026-09-01T00:00:00.000Z",
      created_at: "2026-09-01T00:00:01.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects quality_score outside 0-1", () => {
    const result = SignalSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      competitor_id: "550e8400-e29b-41d4-a716-446655440001",
      source: "hn",
      raw_text: "text",
      quality_score: 1.5,
      collected_at: "2026-09-01T00:00:00.000Z",
      created_at: "2026-09-01T00:00:01.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts entities: null (column has no NOT NULL constraint)", () => {
    const result = SignalSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      competitor_id: "550e8400-e29b-41d4-a716-446655440001",
      source: "reddit",
      source_url: "https://reddit.com/r/saas/comments/abc123",
      title: "Users complaining about pricing",
      raw_text: "Just switched away from Acme because of the price hike.",
      quality_score: 0.72,
      entities: null,
      cluster_id: null,
      collected_at: "2026-09-01T00:00:00.000Z",
      created_at: "2026-09-01T00:00:01.000Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("SignalClusterSchema", () => {
  it("accepts a valid cluster", () => {
    const result = SignalClusterSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440002",
      competitor_id: "550e8400-e29b-41d4-a716-446655440001",
      canonical_summary: "Multiple users report pricing increase confusion",
      contributing_sources: ["reddit", "hn"],
      corroboration_count: 3,
      first_seen_at: "2026-09-01T00:00:00.000Z",
      last_updated: "2026-09-02T00:00:00.000Z",
      created_at: "2026-09-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("SignalScoreSchema", () => {
  it("accepts a valid score with all five components", () => {
    const result = SignalScoreSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440003",
      competitor_id: "550e8400-e29b-41d4-a716-446655440001",
      score: 78,
      components: {
        mention_velocity: 0.8,
        sentiment_trajectory: -0.3,
        hiring_momentum: 0.5,
        pricing_change_recency: 0.9,
        vulnerability_window_status: "open",
      },
      delta_7d: 4.2,
      delta_30d: -1.1,
      computed_at: "2026-09-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects score outside 0-100", () => {
    const result = SignalScoreSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440003",
      competitor_id: "550e8400-e29b-41d4-a716-446655440001",
      score: 150,
      components: {
        mention_velocity: 0.8,
        sentiment_trajectory: -0.3,
        hiring_momentum: 0.5,
        pricing_change_recency: 0.9,
        vulnerability_window_status: "open",
      },
      delta_7d: null,
      delta_30d: null,
      computed_at: "2026-09-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-finite mention_velocity (Infinity)", () => {
    const result = SignalScoreSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440003",
      competitor_id: "550e8400-e29b-41d4-a716-446655440001",
      score: 78,
      components: {
        mention_velocity: Infinity,
        sentiment_trajectory: -0.3,
        hiring_momentum: 0.5,
        pricing_change_recency: 0.9,
        vulnerability_window_status: "open",
      },
      delta_7d: 4.2,
      delta_30d: -1.1,
      computed_at: "2026-09-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("CompetitorDiscoveryResultSchema", () => {
  const log = (over: Record<string, unknown>) => ({
    field_name: "subreddits",
    attempted_urls: ["https://example.com"],
    discovered_value: null,
    status: "not_found",
    error_message: null,
    ...over,
  });

  it("parses a fully-populated result and returns the same shape", () => {
    const input = {
      subreddits: ["saas", "startups"],
      greenhouse_token: "acmeco",
      lever_token: "acme",
      pricing_url: "https://acme.com/pricing",
      changelog_rss: "https://acme.com/changelog.rss",
      logs: [
        log({ field_name: "subreddits", discovered_value: "saas,startups", status: "found" }),
        log({ field_name: "greenhouse", discovered_value: "acmeco", status: "found" }),
        log({ field_name: "lever", status: "not_found" }),
        log({
          field_name: "pricing_url",
          discovered_value: "https://acme.com/pricing",
          status: "found",
        }),
        log({
          field_name: "rss_url",
          status: "error",
          error_message: "timed out fetching feed",
        }),
      ],
    };
    const result = CompetitorDiscoveryResultSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("rejects a logs entry with a status outside the DiscoveryLog enum", () => {
    expect(() =>
      CompetitorDiscoveryResultSchema.parse({
        subreddits: [],
        greenhouse_token: null,
        lever_token: null,
        pricing_url: null,
        changelog_rss: null,
        logs: [log({ status: "partial" })],
      }),
    ).toThrow();
  });

  it("accepts null for every nullable field and empty arrays", () => {
    const result = CompetitorDiscoveryResultSchema.parse({
      subreddits: [],
      greenhouse_token: null,
      lever_token: null,
      pricing_url: null,
      changelog_rss: null,
      logs: [],
    });
    expect(result.subreddits).toEqual([]);
    expect(result.greenhouse_token).toBeNull();
    expect(result.logs).toEqual([]);
  });

  it("fails when a required key is missing", () => {
    const result = CompetitorDiscoveryResultSchema.safeParse({
      greenhouse_token: null,
      lever_token: null,
      pricing_url: null,
      changelog_rss: null,
      logs: [],
    });
    expect(result.success).toBe(false);
  });
});
