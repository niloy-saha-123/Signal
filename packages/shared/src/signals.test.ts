import { describe, it, expect } from "vitest";
import { SignalSchema, SignalClusterSchema, SignalScoreSchema } from "./signals";

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
