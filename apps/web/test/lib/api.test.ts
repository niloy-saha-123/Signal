import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  analyzeCompetitor,
  createCompetitor,
  getCompetitor,
  getCompetitorDiscovery,
  getCompetitorScore,
  listAlerts,
  listCompetitors,
  listSignals,
} from "../../lib/api";

const BASE = "http://localhost:3000";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  );
}

describe("lib/api competitor endpoints", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", BASE);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("listCompetitors GETs /api/competitors and returns the parsed array", async () => {
    const rows = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Acme",
        domain: "acme.com",
        subreddits: [],
        greenhouse_token: null,
        lever_token: null,
        pricing_url: null,
        changelog_rss: null,
        is_active: true,
        discovery_status: "pending",
        discovered_at: null,
        created_at: "2026-09-14T00:00:00.000Z",
        updated_at: "2026-09-14T00:00:00.000Z",
      },
    ];
    mockFetchOnce(200, rows);
    const result = await listCompetitors();
    expect(result).toEqual(rows);
    expect(fetch).toHaveBeenCalledWith(`${BASE}/api/competitors`, expect.any(Object));
  });

  it("getCompetitor GETs /api/competitors/:id", async () => {
    mockFetchOnce(200, { id: "abc", name: "Acme" });
    await getCompetitor("abc");
    expect(fetch).toHaveBeenCalledWith(`${BASE}/api/competitors/abc`, expect.any(Object));
  });

  it("getCompetitor throws ApiError with status+body on 404", async () => {
    mockFetchOnce(404, { error: "not_found" });
    await expect(getCompetitor("missing")).rejects.toMatchObject({
      status: 404,
      body: { error: "not_found" },
    });
    await expect(getCompetitor("missing")).rejects.toBeInstanceOf(ApiError);
  });

  it("createCompetitor rejects an invalid input before calling fetch", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      // @ts-expect-error deliberately invalid: name missing
      createCompetitor({ domain: "acme.com" })
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("createCompetitor POSTs valid input and returns 201 body", async () => {
    const created = { id: "new-id", name: "Acme", domain: "acme.com" };
    mockFetchOnce(201, created);
    const result = await createCompetitor({ name: "Acme", domain: "acme.com" });
    expect(result).toEqual(created);
    const [, init] = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "Acme",
      domain: "acme.com",
    });
  });

  it("getCompetitorScore validates and returns the score shape", async () => {
    const score = {
      score: 72,
      components: {
        mention_velocity: 1.2,
        sentiment_trajectory: -0.3,
        hiring_momentum: 0.5,
        pricing_change_recency: 0,
        vulnerability_window_status: "open",
      },
      computed_at: "2026-09-14T00:00:00.000Z",
      delta_7d: 3,
      delta_30d: null,
    };
    mockFetchOnce(200, score);
    const result = await getCompetitorScore("abc");
    expect(result).toEqual(score);
  });

  it("getCompetitorScore throws when the response fails schema validation", async () => {
    mockFetchOnce(200, { score: 72 }); // missing components/computed_at
    await expect(getCompetitorScore("abc")).rejects.toThrow();
  });

  it("getCompetitorDiscovery validates and returns the discovery shape", async () => {
    const discovery = {
      discovery_status: "in_progress",
      log: [
        {
          field_name: "subreddits",
          attempted_urls: ["https://reddit.com/search?q=acme"],
          discovered_value: null,
          status: "not_found",
          error_message: null,
        },
      ],
    };
    mockFetchOnce(200, discovery);
    const result = await getCompetitorDiscovery("abc");
    expect(result).toEqual(discovery);
  });

  it("analyzeCompetitor POSTs to /:id/analyze and returns run_id+status", async () => {
    mockFetchOnce(202, { run_id: "run-1", status: "running" });
    const result = await analyzeCompetitor("abc");
    expect(result).toEqual({ run_id: "run-1", status: "running" });
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/competitors/abc/analyze`,
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("lib/api signals + alerts endpoints", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", BASE);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const validSignal = {
    id: "11111111-1111-1111-1111-111111111111",
    competitor_id: "22222222-2222-2222-2222-222222222222",
    source: "reddit",
    source_url: "https://reddit.com/r/x/1",
    title: "post title",
    raw_text: "body",
    quality_score: 0.8,
    entities: {},
    cluster_id: null,
    collected_at: "2026-09-14T00:00:00.000Z",
    created_at: "2026-09-14T00:00:00.000Z",
  };

  it("listSignals builds the query string and validates each returned signal", async () => {
    mockFetchOnce(200, { data: [validSignal], next_cursor: "cursor-1" });
    const result = await listSignals({
      competitor_ids: ["22222222-2222-2222-2222-222222222222"],
      sources: ["reddit", "hn"],
      min_quality: 0.5,
      limit: 10,
    });
    expect(result).toEqual({ data: [validSignal], next_cursor: "cursor-1" });
    const [url] = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(url).toBe(
      `${BASE}/api/signals?competitor_ids=22222222-2222-2222-2222-222222222222&sources=reddit%2Chn&min_quality=0.5&limit=10`
    );
  });

  it("listSignals throws when a returned signal fails schema validation", async () => {
    mockFetchOnce(200, { data: [{ id: "not-a-uuid" }], next_cursor: null });
    await expect(
      listSignals({ competitor_ids: ["22222222-2222-2222-2222-222222222222"] })
    ).rejects.toThrow();
  });

  it("listAlerts builds the query string and returns the page", async () => {
    const alert = {
      id: "a1",
      competitor_id: "22222222-2222-2222-2222-222222222222",
      run_id: null,
      pattern: "pricing_cut",
      confidence: 0.9,
      evidence: [],
      interpretation: "text",
      vulnerability_window_days: 14,
      recommended_actions: [],
      supporting_cluster_ids: [],
      delivered: true,
      created_at: "2026-09-14T00:00:00.000Z",
    };
    mockFetchOnce(200, { data: [alert], next_cursor: null });
    const result = await listAlerts({
      competitor_ids: ["22222222-2222-2222-2222-222222222222"],
      limit: 20,
    });
    expect(result).toEqual({ data: [alert], next_cursor: null });
    const [url] = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(url).toBe(
      `${BASE}/api/alerts?competitor_ids=22222222-2222-2222-2222-222222222222&limit=20`
    );
  });
});
