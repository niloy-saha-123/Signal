import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  selectMock,
  fromMock,
  whereMock,
  orderByMock,
  groupByMock,
  limitMock,
  insertMock,
  insertValuesMock,
  onConflictDoUpdateMock,
  onConflictReturningMock,
  insertReturningMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  transactionMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  whereMock: vi.fn(),
  orderByMock: vi.fn(),
  groupByMock: vi.fn(),
  limitMock: vi.fn(),
  insertMock: vi.fn(),
  insertValuesMock: vi.fn(),
  onConflictDoUpdateMock: vi.fn(),
  onConflictReturningMock: vi.fn(),
  insertReturningMock: vi.fn(),
  updateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
    transaction: transactionMock,
  },
}));

// Spy on drizzle-orm's real eq/and/sql/inArray so we can assert the Drizzle call
// shape (which columns/values/raw-SQL text were used) without reimplementing
// SQL compilation in the test.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(actual.eq),
    and: vi.fn(actual.and),
    inArray: vi.fn(actual.inArray),
    sql: Object.assign(vi.fn(actual.sql), actual.sql),
  };
});

import type { CompetitorDiscoveryResult } from "@signal/shared";
import { eq, and, sql, asc, desc, inArray } from "drizzle-orm";
import {
  competitorsTable,
  competitorDiscoveryLogTable,
  signalsTable,
  signalClustersTable,
  competitorSignalScoresTable,
  agentLatenciesTable,
  agentRunsTable,
  alertsTable,
  companyProfileTable,
  pricingBaselinesTable,
  pricingDiffsTable,
} from "@/db/schema";
import {
  createCompetitor,
  getCompetitorsByIds,
  getCompetitorById,
  listCompetitors,
  updateDiscoveryStatus,
  getCompetitorDiscoveryLog,
  getRecentSignalsByCompetitorAndSource,
  getRecentSignalsByCompetitorIds,
  getSignalsByIds,
  getSignalVolumeByDay,
  getLatestSignalScores,
  createSignalScore,
  getLatencyPercentiles,
  getCompanyProfile,
  upsertCompanyProfile,
  getLatestSignalCollectedAt,
  getFirstSignalCollectedAt,
  signalExistsBySourceUrl,
  createSignal,
  listSignalFeed,
  listAlertFeed,
  createAlert,
  createPricingBaseline,
  getLatestPricingBaseline,
  createPricingDiff,
  getRecentPricingDiffs,
  getSignalById,
  updateSignalEntities,
  updateSignalQualityScore,
  createClusterForSignalPair,
  getSignalClusterById,
  mergeSignalIntoCluster,
  completeAgentRun,
  failRunIfRunning,
  createAgentRun,
  finalizeDiscovery,
} from "@/db/queries";

// Joins a tagged-template call's strings with `?` placeholders so we can
// assert on the raw SQL text a `sql` call produced.
function rawSqlText(call: unknown[]): string {
  const strings = call[0] as unknown as { raw?: string[] } | string[];
  const parts = Array.isArray(strings) ? strings : (strings.raw ?? []);
  return parts.join("?");
}

describe("db/queries — competitors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    insertMock.mockReturnValue({ values: insertValuesMock });
    insertValuesMock.mockReturnValue({ returning: insertReturningMock });
    updateMock.mockReturnValue({ set: updateSetMock });
    updateSetMock.mockReturnValue({ where: updateWhereMock });
  });

  describe("createCompetitor", () => {
    it("inserts with discovery_status defaulted to pending and returns the created row", async () => {
      const row = { id: "c1", name: "Acme", domain: "acme.com", discovery_status: "pending" };
      insertReturningMock.mockResolvedValue([row]);

      const result = await createCompetitor({ name: "Acme", domain: "acme.com" });

      expect(insertMock).toHaveBeenCalledWith(competitorsTable);
      expect(insertValuesMock).toHaveBeenCalledWith({
        name: "Acme",
        domain: "acme.com",
        discovery_status: "pending",
      });
      expect(result).toEqual(row);
    });

    it("persists caller-supplied discovery overrides using schema column names", async () => {
      insertReturningMock.mockResolvedValue([{ id: "c1" }]);

      await createCompetitor({
        name: "Acme",
        domain: "acme.com",
        subreddits: ["acme"],
        greenhouse_token: "acmehq",
        lever_token: "acme",
        pricing_url: "https://acme.com/pricing",
        rss_url: "https://acme.com/changelog.xml",
      });

      expect(insertValuesMock).toHaveBeenCalledWith({
        name: "Acme",
        domain: "acme.com",
        subreddits: ["acme"],
        greenhouse_token: "acmehq",
        lever_token: "acme",
        pricing_url: "https://acme.com/pricing",
        changelog_rss: "https://acme.com/changelog.xml",
        discovery_status: "pending",
      });
    });
  });

  describe("getCompetitorsByIds", () => {
    it("loads all requested competitors in one set-based query", async () => {
      const rows = [{ id: "c1" }, { id: "c2" }];
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue(rows);

      await expect(getCompetitorsByIds(["c1", "c2"])).resolves.toEqual(rows);

      expect(inArray).toHaveBeenCalledWith(competitorsTable.id, ["c1", "c2"]);
      expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it("short-circuits an empty id array", async () => {
      await expect(getCompetitorsByIds([])).resolves.toEqual([]);
      expect(selectMock).not.toHaveBeenCalled();
    });
  });

  describe("getCompetitorById", () => {
    it("selects by id and returns the first row", async () => {
      const row = { id: "c1", name: "Acme" };
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([row]);

      const result = await getCompetitorById("c1");

      expect(selectMock).toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalledWith(competitorsTable);
      expect(whereMock).toHaveBeenCalled();
      expect(result).toEqual(row);
    });

    it("returns undefined when no row matches", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([]);

      const result = await getCompetitorById("missing");

      expect(result).toBeUndefined();
    });
  });

  describe("listCompetitors", () => {
    it("selects all competitors ordered by created_at desc", async () => {
      const rows = [{ id: "c1" }, { id: "c2" }];
      fromMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockResolvedValue(rows);

      const result = await listCompetitors();

      expect(fromMock).toHaveBeenCalledWith(competitorsTable);
      expect(orderByMock).toHaveBeenCalled();
      expect(result).toEqual(rows);
    });
  });

  describe("updateDiscoveryStatus", () => {
    it("updates discovery_status and updated_at for the given id", async () => {
      updateWhereMock.mockResolvedValue(undefined);

      await updateDiscoveryStatus("c1", "complete");

      expect(updateMock).toHaveBeenCalledWith(competitorsTable);
      expect(updateSetMock).toHaveBeenCalledWith({
        discovery_status: "complete",
        updated_at: expect.any(Date),
      });
      expect(updateWhereMock).toHaveBeenCalled();
    });

    it("rejects status 'failed' without touching db.update — failures must route through writeDiscoveryFailure so they're logged", async () => {
      await expect(updateDiscoveryStatus("c1", "failed")).rejects.toThrow(
        "updateDiscoveryStatus does not accept 'failed' — route failures through writeDiscoveryFailure so they're logged"
      );

      expect(updateMock).not.toHaveBeenCalled();
    });
  });

  describe("getCompetitorDiscoveryLog", () => {
    it("selects log rows for a competitor ordered by discovered_at", async () => {
      const rows = [{ id: "log1", discovered_at: new Date() }];
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockResolvedValue(rows);

      const result = await getCompetitorDiscoveryLog("c1");

      expect(fromMock).toHaveBeenCalledWith(competitorDiscoveryLogTable);
      expect(whereMock).toHaveBeenCalled();
      expect(orderByMock).toHaveBeenCalledWith(competitorDiscoveryLogTable.discovered_at);
      expect(result).toEqual(rows);
    });
  });
});

describe("db/queries — signals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
  });

  describe("getRecentSignalsByCompetitorAndSource", () => {
    it("filters by competitor_id, source, and a created_at date window (7-day default)", async () => {
      const rows = [{ id: "s1", competitor_id: "c1", source: "jobs" }];
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue(rows);

      const result = await getRecentSignalsByCompetitorAndSource("c1", "jobs");

      expect(fromMock).toHaveBeenCalledWith(signalsTable);
      expect(eq).toHaveBeenCalledWith(signalsTable.competitor_id, "c1");
      expect(eq).toHaveBeenCalledWith(signalsTable.source, "jobs");

      // and() must be called with exactly 3 predicates: competitor_id, source, date window.
      expect(and).toHaveBeenCalledTimes(1);
      expect((and as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(3);

      // The date-window predicate is a raw sql fragment referencing created_at
      // and a parameterized day count — not a hardcoded interval.
      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall).toBeDefined();
      expect(rawSqlText(intervalCall!)).toContain("NOW() - INTERVAL");
      expect(intervalCall!.at(-1)).toBe(7);

      expect(whereMock).toHaveBeenCalled();
      expect(orderByMock).toHaveBeenCalledWith(desc(signalsTable.created_at));
      expect(limitMock).toHaveBeenCalledWith(500);
      expect(result).toEqual(rows);
    });

    it("honors a custom days window", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([]);

      await getRecentSignalsByCompetitorAndSource("c1", "reddit", 14);

      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall!.at(-1)).toBe(14);
    });
  });

  describe("getRecentSignalsByCompetitorIds", () => {
    it("filters by multiple competitor_ids and a created_at date window (7-day default)", async () => {
      const rows = [
        { id: "s1", competitor_id: "c1", source: "jobs" },
        { id: "s2", competitor_id: "c2", source: "reddit" },
      ];
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue(rows);

      const result = await getRecentSignalsByCompetitorIds(["c1", "c2"]);

      expect(fromMock).toHaveBeenCalledWith(signalsTable);
      expect(inArray).toHaveBeenCalledWith(signalsTable.competitor_id, ["c1", "c2"]);
      expect(whereMock).toHaveBeenCalled();
      // and() must be called with exactly 2 predicates: competitor_ids filter and date window.
      expect(and).toHaveBeenCalledTimes(1);
      expect((and as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(2);

      // The date-window predicate is a raw sql fragment
      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall).toBeDefined();
      expect(rawSqlText(intervalCall!)).toContain("NOW() - INTERVAL");
      expect(intervalCall!.at(-1)).toBe(7);

      expect(result).toEqual(rows);
    });

    it("honors a custom days window", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([]);

      await getRecentSignalsByCompetitorIds(["c1", "c2"], 14);

      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall!.at(-1)).toBe(14);
    });

    it("returns empty array immediately when competitorIds is empty, without issuing a query", async () => {
      const result = await getRecentSignalsByCompetitorIds([]);

      expect(selectMock).not.toHaveBeenCalled();
      expect(fromMock).not.toHaveBeenCalled();
      expect(whereMock).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe("getSignalsByIds", () => {
    it("filters by multiple signal ids", async () => {
      const rows = [
        { id: "s1", raw_text: "Text 1", quality_score: 0.8 },
        { id: "s2", raw_text: "Text 2", quality_score: 0.6 },
      ];
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue(rows);

      const result = await getSignalsByIds(["s1", "s2"]);

      expect(fromMock).toHaveBeenCalledWith(signalsTable);
      expect(inArray).toHaveBeenCalledWith(signalsTable.id, ["s1", "s2"]);
      expect(whereMock).toHaveBeenCalled();
      expect(result).toEqual(rows);
    });

    it("returns empty array immediately when ids is empty, without issuing a query", async () => {
      const result = await getSignalsByIds([]);

      expect(selectMock).not.toHaveBeenCalled();
      expect(fromMock).not.toHaveBeenCalled();
      expect(whereMock).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe("getSignalVolumeByDay", () => {
    it("selects DATE_TRUNC('day', created_at) grouped with COUNT and SUM(quality_score) (30-day default)", async () => {
      const rows = [{ day: "2026-09-01", count: 3, weighted_count: 1.5 }];
      const groupByChain = { groupBy: groupByMock };
      const orderByChain = { orderBy: orderByMock };
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue(groupByChain);
      groupByMock.mockReturnValue(orderByChain);
      orderByMock.mockResolvedValue(rows);

      const result = await getSignalVolumeByDay("c1");

      expect(selectMock).toHaveBeenCalledWith({
        day: expect.anything(),
        count: expect.anything(),
        weighted_count: expect.anything(),
      });
      expect(fromMock).toHaveBeenCalledWith(signalsTable);
      expect(eq).toHaveBeenCalledWith(signalsTable.competitor_id, "c1");
      expect(groupByMock).toHaveBeenCalled();
      expect(orderByMock).toHaveBeenCalled();

      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const rawTexts = sqlCalls.map(rawSqlText);

      // Correctness-critical: exact raw SQL text for each fragment.
      // The db call is mocked (no real Postgres), so we can't observe the pg
      // driver's actual type parsing here — instead we assert the ::int/::text
      // casts that make it produce real numbers/strings are present in the
      // query text. Without them: COUNT(*) comes back as bigint -> JS string
      // "3", and DATE_TRUNC on a timestamptz column comes back as a JS Date,
      // not a string, silently violating SignalVolumeByDay's declared types.
      expect(rawTexts.some((t) => t.includes("DATE_TRUNC('day', ?)::text"))).toBe(true);
      expect(rawTexts.some((t) => t === "COUNT(*)::int")).toBe(true);
      expect(rawTexts.some((t) => t.includes("SUM(?)"))).toBe(true);
      expect(rawTexts.some((t) => t.includes("NOW() - INTERVAL"))).toBe(true);

      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall!.at(-1)).toBe(30);

      expect(result).toEqual(rows);
    });

    it("returns count as a real number and day as a real string, not the pre-cast bigint/Date shapes", async () => {
      // Simulates what the row would look like WITHOUT the ::int/::text casts
      // (pg returns bigint as string, timestamptz as Date) to prove this
      // function's contract is only honored because the SQL casts are in
      // place — if a future edit drops them, this mismatch would surface as
      // a type-lie the same way the reviewed bug did.
      const castRows = [{ day: "2026-09-01T00:00:00.000Z", count: 3, weighted_count: 1.5 }];
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ groupBy: groupByMock });
      groupByMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockResolvedValue(castRows);

      const result = await getSignalVolumeByDay("c1");

      expect(result).toEqual(castRows);
      expect(typeof result[0].count).toBe("number");
      expect(typeof result[0].day).toBe("string");

      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const rawTexts = sqlCalls.map(rawSqlText);
      expect(rawTexts.some((t) => t === "COUNT(*)::int")).toBe(true);
      expect(rawTexts.some((t) => t.includes("::text"))).toBe(true);
    });

    it("honors a custom days window", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ groupBy: groupByMock });
      groupByMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockResolvedValue([]);

      await getSignalVolumeByDay("c1", 90);

      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall!.at(-1)).toBe(90);
    });
  });
});

describe("db/queries — hn collector support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    insertMock.mockReturnValue({ values: insertValuesMock });
    insertValuesMock.mockReturnValue({ returning: insertReturningMock });
  });

  describe("getLatestSignalCollectedAt", () => {
    it("selects the most recent collected_at for a competitor+source, most-recent first", async () => {
      const collectedAt = new Date("2026-09-01T00:00:00.000Z");
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([{ collected_at: collectedAt }]);

      const result = await getLatestSignalCollectedAt("c1", "hn");

      expect(fromMock).toHaveBeenCalledWith(signalsTable);
      expect(eq).toHaveBeenCalledWith(signalsTable.competitor_id, "c1");
      expect(eq).toHaveBeenCalledWith(signalsTable.source, "hn");
      expect(orderByMock).toHaveBeenCalledWith(desc(signalsTable.collected_at));
      expect(limitMock).toHaveBeenCalledWith(1);
      expect(result).toEqual(collectedAt);
    });

    it("returns undefined when this competitor+source has no prior signals", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([]);

      const result = await getLatestSignalCollectedAt("c1", "hn");

      expect(result).toBeUndefined();
    });
  });

  describe("getFirstSignalCollectedAt", () => {
    it("selects the earliest collected_at for a competitor across all sources, oldest first", async () => {
      const collectedAt = new Date("2026-01-01T00:00:00.000Z");
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([{ collected_at: collectedAt }]);

      const result = await getFirstSignalCollectedAt("c1");

      expect(fromMock).toHaveBeenCalledWith(signalsTable);
      expect(eq).toHaveBeenCalledWith(signalsTable.competitor_id, "c1");
      expect(orderByMock).toHaveBeenCalledWith(asc(signalsTable.collected_at));
      expect(limitMock).toHaveBeenCalledWith(1);
      expect(result).toEqual(collectedAt);
    });

    it("returns undefined when this competitor has no signals at all", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([]);

      const result = await getFirstSignalCollectedAt("c1");

      expect(result).toBeUndefined();
    });
  });

  describe("signalExistsBySourceUrl", () => {
    it("returns true when a signal with that source_url already exists for this competitor+source", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([{ id: "s1" }]);

      const result = await signalExistsBySourceUrl("c1", "hn", "https://news.ycombinator.com/item?id=1");

      expect(fromMock).toHaveBeenCalledWith(signalsTable);
      expect(eq).toHaveBeenCalledWith(signalsTable.competitor_id, "c1");
      expect(eq).toHaveBeenCalledWith(signalsTable.source, "hn");
      expect(eq).toHaveBeenCalledWith(signalsTable.source_url, "https://news.ycombinator.com/item?id=1");
      expect(limitMock).toHaveBeenCalledWith(1);
      expect(result).toBe(true);
    });

    it("returns false when no matching signal exists", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([]);

      const result = await signalExistsBySourceUrl("c1", "hn", "https://news.ycombinator.com/item?id=1");

      expect(result).toBe(false);
    });
  });

  describe("createSignal", () => {
    it("inserts the given fields and returns the created row", async () => {
      const input = {
        competitor_id: "c1",
        source: "hn" as const,
        source_url: "https://news.ycombinator.com/item?id=1",
        title: "Acme raises Series B",
        raw_text: "Acme just raised a Series B",
      };
      const row = { id: "s1", ...input, quality_score: 0, collected_at: new Date(), created_at: new Date() };
      insertReturningMock.mockResolvedValue([row]);

      const result = await createSignal(input);

      expect(insertMock).toHaveBeenCalledWith(signalsTable);
      expect(insertValuesMock).toHaveBeenCalledWith(input);
      expect(result).toEqual(row);
    });
  });
});

describe("db/queries — pricing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    insertMock.mockReturnValue({ values: insertValuesMock });
    insertValuesMock.mockReturnValue({ returning: insertReturningMock });
  });

  describe("createPricingBaseline", () => {
    it("inserts the given fields and returns the created row", async () => {
      const input = { competitor_id: "c1", snapshot: { raw_text: "Pro plan $99/mo" } };
      const row = { id: "b1", ...input, captured_at: new Date(), created_at: new Date() };
      insertReturningMock.mockResolvedValue([row]);

      const result = await createPricingBaseline(input);

      expect(insertMock).toHaveBeenCalledWith(pricingBaselinesTable);
      expect(insertValuesMock).toHaveBeenCalledWith(input);
      expect(result).toEqual(row);
    });
  });

  describe("getLatestPricingBaseline", () => {
    it("selects the most recent baseline for a competitor, most-recent first", async () => {
      const row = { id: "b1", competitor_id: "c1", snapshot: { raw_text: "old" }, captured_at: new Date() };
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([row]);

      const result = await getLatestPricingBaseline("c1");

      expect(fromMock).toHaveBeenCalledWith(pricingBaselinesTable);
      expect(eq).toHaveBeenCalledWith(pricingBaselinesTable.competitor_id, "c1");
      expect(orderByMock).toHaveBeenCalledWith(desc(pricingBaselinesTable.captured_at));
      expect(limitMock).toHaveBeenCalledWith(1);
      expect(result).toEqual(row);
    });

    it("returns undefined when this competitor has no prior baseline", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([]);

      const result = await getLatestPricingBaseline("c1");

      expect(result).toBeUndefined();
    });
  });

  describe("createPricingDiff", () => {
    it("inserts the given fields and returns the created row", async () => {
      const input = {
        competitor_id: "c1",
        baseline_id: "b2",
        diff: { added: ["Enterprise $499/mo"], removed: [] },
        significance: "critical" as const,
      };
      const row = { id: "d1", ...input, detected_at: new Date(), created_at: new Date() };
      insertReturningMock.mockResolvedValue([row]);

      const result = await createPricingDiff(input);

      expect(insertMock).toHaveBeenCalledWith(pricingDiffsTable);
      expect(insertValuesMock).toHaveBeenCalledWith(input);
      expect(result).toEqual(row);
    });
  });

  describe("getRecentPricingDiffs", () => {
    it("filters by competitor_id and a detected_at date window (7-day default), most recent first", async () => {
      const rows = [{ id: "d1", competitor_id: "c1", significance: "critical" }];
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue(rows);

      const result = await getRecentPricingDiffs("c1");

      expect(fromMock).toHaveBeenCalledWith(pricingDiffsTable);
      expect(eq).toHaveBeenCalledWith(pricingDiffsTable.competitor_id, "c1");

      // and() must be called with exactly 2 predicates: competitor_id, date window.
      expect(and).toHaveBeenCalledTimes(1);
      expect((and as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(2);

      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall).toBeDefined();
      expect(rawSqlText(intervalCall!)).toContain("NOW() - INTERVAL");
      expect(intervalCall!.at(-1)).toBe(7);

      expect(orderByMock).toHaveBeenCalledWith(desc(pricingDiffsTable.detected_at));
      expect(limitMock).toHaveBeenCalledWith(500);
      expect(result).toEqual(rows);
    });

    it("honors a custom days window", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([]);

      await getRecentPricingDiffs("c1", 14);

      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall!.at(-1)).toBe(14);
    });
  });
});

describe("db/queries — signal scores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    insertMock.mockReturnValue({ values: insertValuesMock });
    insertValuesMock.mockReturnValue({ returning: insertReturningMock });
  });

  describe("getLatestSignalScores", () => {
    it("selects by competitor_id, orders computed_at desc, and applies the default limit of 30", async () => {
      const rows = [{ id: "s1", competitor_id: "c1", score: 72, computed_at: new Date() }];
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue(rows);

      const result = await getLatestSignalScores("c1");

      expect(fromMock).toHaveBeenCalledWith(competitorSignalScoresTable);
      expect(eq).toHaveBeenCalledWith(competitorSignalScoresTable.competitor_id, "c1");
      expect(whereMock).toHaveBeenCalled();
      expect(orderByMock).toHaveBeenCalledWith(desc(competitorSignalScoresTable.computed_at));
      expect(limitMock).toHaveBeenCalledWith(30);
      expect(result).toEqual(rows);
    });

    it("honors a custom limit", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([]);

      await getLatestSignalScores("c1", 5);

      expect(limitMock).toHaveBeenCalledWith(5);
    });
  });

  describe("createSignalScore", () => {
    it("upserts the UTC-day row and returns it", async () => {
      const input = {
        competitor_id: "c1",
        score: 72,
        components: { hiring: 0.4, sentiment: 0.2 },
        delta_7d: 3.5,
        delta_30d: -1.2,
      };
      const row = { id: "s1", ...input, computed_at: new Date() };
      insertValuesMock.mockReturnValueOnce({ onConflictDoUpdate: onConflictDoUpdateMock });
      onConflictDoUpdateMock.mockReturnValueOnce({ returning: onConflictReturningMock });
      onConflictReturningMock.mockResolvedValueOnce([row]);

      const result = await createSignalScore(input);

      expect(insertMock).toHaveBeenCalledWith(competitorSignalScoresTable);
      expect(insertValuesMock).toHaveBeenCalledWith(input);
      expect(onConflictDoUpdateMock).toHaveBeenCalledWith({
        target: [
          competitorSignalScoresTable.competitor_id,
          competitorSignalScoresTable.day,
        ],
        set: {
          score: 72,
          components: { hiring: 0.4, sentiment: 0.2 },
          delta_7d: 3.5,
          delta_30d: -1.2,
          computed_at: expect.anything(),
        },
      });
      expect(result).toEqual(row);
    });
  });
});

describe("db/queries — latency percentiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
  });

  describe("getLatencyPercentiles", () => {
    it("groups by agent_name, filters created_at >= NOW() - INTERVAL for the given days (7-day default), and computes p50/p95 via PERCENTILE_CONT", async () => {
      const rows = [{ agent_name: "synthesis", p50: 120.5, p95: 480.25 }];
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ groupBy: groupByMock });
      groupByMock.mockResolvedValue(rows);

      const result = await getLatencyPercentiles();

      expect(selectMock).toHaveBeenCalledWith({
        agent_name: agentLatenciesTable.agent_name,
        p50: expect.anything(),
        p95: expect.anything(),
      });
      expect(fromMock).toHaveBeenCalledWith(agentLatenciesTable);
      expect(groupByMock).toHaveBeenCalledWith(agentLatenciesTable.agent_name);

      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const rawTexts = sqlCalls.map(rawSqlText);

      // Drizzle's fluent builder can't express PERCENTILE_CONT WITHIN GROUP —
      // assert the raw SQL text directly, per the task brief.
      expect(
        rawTexts.some((t) => t.includes("PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY"))
      ).toBe(true);
      expect(
        rawTexts.some((t) => t.includes("PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY"))
      ).toBe(true);
      expect(rawTexts.some((t) => t.includes("NOW() - INTERVAL"))).toBe(true);

      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall!.at(-1)).toBe(7);

      expect(result).toEqual(rows);
    });

    it("honors a custom days window", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ groupBy: groupByMock });
      groupByMock.mockResolvedValue([]);

      await getLatencyPercentiles(14);

      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall!.at(-1)).toBe(14);
    });
  });
});

describe("db/queries — company profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    // getCompanyProfile chains .orderBy().limit(1); upsertCompanyProfile's
    // tx.select() chains .limit(1) directly (unchanged, out of scope for
    // this fix) — expose both off the same fromMock return so each test's
    // limitMock.mockResolvedValue(...) reaches whichever chain it uses.
    fromMock.mockReturnValue({ orderBy: orderByMock, limit: limitMock });
    orderByMock.mockReturnValue({ limit: limitMock });
    insertMock.mockReturnValue({ values: insertValuesMock });
    insertValuesMock.mockReturnValue({ returning: insertReturningMock });
    updateMock.mockReturnValue({ set: updateSetMock });
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    // db.transaction runs the callback against a tx that exposes the same
    // select/insert/update surface as `db` — matches registry.ts's pattern.
    transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({ select: selectMock, insert: insertMock, update: updateMock })
    );
  });

  const profileInput = {
    product_description: "A widget factory",
    icp_company_size: "50-200",
    icp_industries: ["saas"],
    icp_buyer_role: "VP Eng",
    pricing_tiers: [{ name: "Pro", price: 99, billing: "monthly" }],
    key_differentiators: ["fast", "cheap"],
    primary_competitor_ids: ["c1"],
  };

  describe("getCompanyProfile", () => {
    it("returns the single row when the table has one", async () => {
      const row = { id: "p1", product_description: "A widget factory" };
      limitMock.mockResolvedValue([row]);

      const result = await getCompanyProfile();

      expect(fromMock).toHaveBeenCalledWith(companyProfileTable);
      expect(orderByMock).toHaveBeenCalledWith(asc(companyProfileTable.created_at));
      expect(limitMock).toHaveBeenCalledWith(1);
      expect(result).toEqual(row);
    });

    it("returns null on an empty table, not throw", async () => {
      limitMock.mockResolvedValue([]);

      const result = await getCompanyProfile();

      expect(result).toBeNull();
    });

    it("orders by created_at asc, so a stray duplicate row deterministically resolves to the oldest one", async () => {
      const older = {
        id: "p1",
        product_description: "Older row",
        created_at: new Date("2026-01-01T00:00:00.000Z"),
      };
      const newer = {
        id: "p2",
        product_description: "Newer row (duplicate from a race)",
        created_at: new Date("2026-02-01T00:00:00.000Z"),
      };
      // orderBy(asc(created_at)) + limit(1) means Postgres itself would only
      // ever return the oldest row here; seeding both simulates that.
      limitMock.mockResolvedValue([older, newer]);

      const result = await getCompanyProfile();

      expect(orderByMock).toHaveBeenCalledWith(asc(companyProfileTable.created_at));
      expect(result).toEqual(older);
    });
  });

  describe("upsertCompanyProfile", () => {
    it("atomically upserts the singleton row", async () => {
      const inserted = { id: "p2", ...profileInput };
      insertValuesMock.mockReturnValueOnce({ onConflictDoUpdate: onConflictDoUpdateMock });
      onConflictDoUpdateMock.mockReturnValueOnce({ returning: onConflictReturningMock });
      onConflictReturningMock.mockResolvedValueOnce([inserted]);

      const result = await upsertCompanyProfile(profileInput);

      expect(insertMock).toHaveBeenCalledWith(companyProfileTable);
      expect(insertValuesMock).toHaveBeenCalledWith({ ...profileInput, singleton: true });
      expect(onConflictDoUpdateMock).toHaveBeenCalledWith({
        target: companyProfileTable.singleton,
        set: { ...profileInput, singleton: true, updated_at: expect.any(Date) },
      });
      expect(result).toEqual(inserted);
    });
  });
});

describe("db/queries — signal pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    insertMock.mockReturnValue({ values: insertValuesMock });
    insertValuesMock.mockReturnValue({ returning: insertReturningMock });
    updateMock.mockReturnValue({ set: updateSetMock });
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue(undefined);
  });

  describe("getSignalById", () => {
    it("selects by id and returns the first row", async () => {
      const row = { id: "s1", raw_text: "Acme raised a Series B" };
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([row]);

      const result = await getSignalById("s1");

      expect(fromMock).toHaveBeenCalledWith(signalsTable);
      expect(eq).toHaveBeenCalledWith(signalsTable.id, "s1");
      expect(result).toEqual(row);
    });

    it("returns undefined when no row matches", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([]);

      const result = await getSignalById("missing");

      expect(result).toBeUndefined();
    });
  });

  describe("updateSignalEntities", () => {
    it("sets entities for the given signal id", async () => {
      const entities = { prices: ["$99/mo"], products: [], features: [] };

      await updateSignalEntities("s1", entities);

      expect(updateMock).toHaveBeenCalledWith(signalsTable);
      expect(updateSetMock).toHaveBeenCalledWith({ entities });
      expect(eq).toHaveBeenCalledWith(signalsTable.id, "s1");
      expect(updateWhereMock).toHaveBeenCalled();
    });
  });

  describe("updateSignalQualityScore", () => {
    it("sets quality_score for the given signal id", async () => {
      await updateSignalQualityScore("s1", 0.72);

      expect(updateMock).toHaveBeenCalledWith(signalsTable);
      expect(updateSetMock).toHaveBeenCalledWith({ quality_score: 0.72 });
      expect(eq).toHaveBeenCalledWith(signalsTable.id, "s1");
      expect(updateWhereMock).toHaveBeenCalled();
    });
  });

  describe("createClusterForSignalPair", () => {
    const pairInput = {
      competitor_id: "c1",
      canonical_summary: "Acme raised a Series B",
      matched_signal_id: "matched1",
      matched_source: "hn",
      new_signal_id: "s1",
      new_source: "reddit",
    };

    beforeEach(() => {
      transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ insert: insertMock, update: updateMock })
      );
    });

    it("writes the cluster row and both signals' cluster_id inside one transaction", async () => {
      const cluster = { id: "cluster-1", competitor_id: "c1" };
      insertReturningMock.mockResolvedValue([cluster]);

      const result = await createClusterForSignalPair(pairInput);

      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(insertMock).toHaveBeenCalledWith(signalClustersTable);
      expect(insertValuesMock).toHaveBeenCalledWith({
        competitor_id: "c1",
        canonical_summary: "Acme raised a Series B",
        contributing_sources: ["hn", "reddit"],
        // Two signals corroborate the cluster from the moment it exists — the
        // column's own default of 1 would undercount it.
        corroboration_count: 2,
      });
      expect(updateMock).toHaveBeenCalledWith(signalsTable);
      expect(updateSetMock).toHaveBeenCalledWith({ cluster_id: "cluster-1" });
      expect(result).toEqual(cluster);
    });

    it("does not duplicate the source when both signals came from the same one", async () => {
      insertReturningMock.mockResolvedValue([{ id: "cluster-1" }]);

      await createClusterForSignalPair({ ...pairInput, matched_source: "reddit" });

      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({ contributing_sources: ["reddit"] })
      );
    });

    // A failure partway through must not commit the cluster row on its own — that
    // orphan is what let a BullMQ retry create a second cluster.
    it("propagates a failure from inside the transaction so nothing is committed", async () => {
      insertReturningMock.mockResolvedValue([{ id: "cluster-1" }]);
      updateWhereMock.mockRejectedValueOnce(new Error("connection reset"));

      await expect(createClusterForSignalPair(pairInput)).rejects.toThrow("connection reset");
    });
  });

  describe("getSignalClusterById", () => {
    it("selects by id and returns the first row", async () => {
      const row = { id: "cluster-1", canonical_summary: "Acme raised a Series B" };
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([row]);

      const result = await getSignalClusterById("cluster-1");

      expect(fromMock).toHaveBeenCalledWith(signalClustersTable);
      expect(eq).toHaveBeenCalledWith(signalClustersTable.id, "cluster-1");
      expect(result).toEqual(row);
    });

    it("returns undefined when no row matches", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([]);

      const result = await getSignalClusterById("missing");

      expect(result).toBeUndefined();
    });
  });

  describe("mergeSignalIntoCluster", () => {
    beforeEach(() => {
      transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ select: selectMock, update: updateMock })
      );
    });

    it("appends a new source, increments corroboration_count, and bumps last_updated", async () => {
      const existing = {
        id: "cluster-1",
        contributing_sources: ["hn"],
        corroboration_count: 2,
      };
      const updated = {
        ...existing,
        contributing_sources: ["hn", "reddit"],
        corroboration_count: 3,
        last_updated: new Date(),
      };
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([existing]);
      updateWhereMock.mockReturnValue({ returning: updateReturningMock });
      updateReturningMock.mockResolvedValue([updated]);

      const result = await mergeSignalIntoCluster("cluster-1", "s1", "reddit");

      expect(fromMock).toHaveBeenCalledWith(signalClustersTable);
      expect(updateMock).toHaveBeenCalledWith(signalClustersTable);
      expect(updateSetMock).toHaveBeenCalledWith({
        contributing_sources: ["hn", "reddit"],
        corroboration_count: 3,
        last_updated: expect.any(Date),
      });
      expect(result).toEqual(updated);
    });

    // The corroboration bump and the joining signal's cluster_id must commit together:
    // split apart, a failure between them let a BullMQ retry increment the count twice.
    it("stamps the joining signal's cluster_id in the same transaction as the bump", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([
        { id: "cluster-1", contributing_sources: ["hn"], corroboration_count: 2 },
      ]);
      updateWhereMock.mockReturnValue({ returning: updateReturningMock });
      updateReturningMock.mockResolvedValue([{ id: "cluster-1" }]);

      await mergeSignalIntoCluster("cluster-1", "s1", "reddit");

      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledWith(signalsTable);
      expect(updateSetMock).toHaveBeenCalledWith({ cluster_id: "cluster-1" });
    });

    it("does not double-append a source already present in contributing_sources", async () => {
      const existing = {
        id: "cluster-1",
        contributing_sources: ["hn", "reddit"],
        corroboration_count: 2,
      };
      const updated = {
        ...existing,
        corroboration_count: 3,
        last_updated: new Date(),
      };
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([existing]);
      updateWhereMock.mockReturnValue({ returning: updateReturningMock });
      updateReturningMock.mockResolvedValue([updated]);

      const result = await mergeSignalIntoCluster("cluster-1", "s1", "reddit");

      // Second signal from a source already in contributing_sources — the array
      // must stay exactly as it was, not grow a duplicate "reddit" entry.
      expect(updateSetMock).toHaveBeenCalledWith({
        contributing_sources: ["hn", "reddit"],
        corroboration_count: 3,
        last_updated: expect.any(Date),
      });
      expect(result).toEqual(updated);
    });

    it("throws when the cluster does not exist", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([]);

      await expect(mergeSignalIntoCluster("missing", "s1", "reddit")).rejects.toThrow("missing");
      expect(updateMock).not.toHaveBeenCalled();
    });
  });
});

describe("db/queries — agent runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReturnValue({ values: insertValuesMock });
    insertValuesMock.mockReturnValue({ returning: insertReturningMock });
    updateMock.mockReturnValue({ set: updateSetMock });
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue(undefined);
  });

  describe("createAgentRun", () => {
    it("creates a running lifecycle row and returns it", async () => {
      const row = { id: "run-1", competitor_id: "c1", trigger: "manual", status: "running" };
      insertReturningMock.mockResolvedValue([row]);

      await expect(createAgentRun({ competitor_id: "c1", trigger: "manual" })).resolves.toEqual(
        row
      );

      expect(insertMock).toHaveBeenCalledWith(agentRunsTable);
      expect(insertValuesMock).toHaveBeenCalledWith({
        competitor_id: "c1",
        trigger: "manual",
        status: "running",
      });
    });
  });

  describe("completeAgentRun", () => {
    it("sets status, outcome, and completed_at for the given run id", async () => {
      await completeAgentRun("run-1", "completed", "alert");

      expect(updateMock).toHaveBeenCalledWith(agentRunsTable);
      expect(updateSetMock).toHaveBeenCalledWith({
        status: "completed",
        outcome: "alert",
        completed_at: expect.any(Date),
      });
      expect(eq).toHaveBeenCalledWith(agentRunsTable.id, "run-1");
      expect(eq).toHaveBeenCalledWith(agentRunsTable.status, "running");
      expect(and).toHaveBeenCalled();
      expect(updateWhereMock).toHaveBeenCalled();
    });

    it("allows an undefined outcome (e.g. a failed run with no outcome yet)", async () => {
      await completeAgentRun("run-1", "failed");

      expect(updateSetMock).toHaveBeenCalledWith({
        status: "failed",
        outcome: undefined,
        completed_at: expect.any(Date),
      });
    });
  });

  describe("failRunIfRunning", () => {
    it("marks only a still-running row failed", async () => {
      await failRunIfRunning("run-1");

      expect(updateMock).toHaveBeenCalledWith(agentRunsTable);
      expect(updateSetMock).toHaveBeenCalledWith({
        status: "failed",
        completed_at: expect.any(Date),
      });
      expect(eq).toHaveBeenCalledWith(agentRunsTable.id, "run-1");
      expect(eq).toHaveBeenCalledWith(agentRunsTable.status, "running");
      expect(and).toHaveBeenCalled();
      expect(updateWhereMock).toHaveBeenCalled();
    });
  });
});

describe("db/queries — route feeds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: whereMock });
    whereMock.mockReturnValue({ orderBy: orderByMock });
    orderByMock.mockReturnValue({ limit: limitMock });
    limitMock.mockResolvedValue([]);
    insertMock.mockReturnValue({ values: insertValuesMock });
    insertValuesMock.mockReturnValue({ returning: insertReturningMock });
  });

  it("reads one extra signal with deterministic descending keyset pagination", async () => {
    await listSignalFeed({
      limit: 20,
      competitor_ids: ["c1", "c2"],
      sources: ["reddit", "jobs"],
      min_quality: 0.6,
      created_after: new Date("2026-09-01T00:00:00.000Z"),
      created_before: new Date("2026-09-10T00:00:00.000Z"),
      cursor: { created_at: new Date("2026-09-09T12:00:00.000Z"), id: "s1" },
    });

    expect(fromMock).toHaveBeenCalledWith(signalsTable);
    expect(inArray).toHaveBeenCalledWith(signalsTable.competitor_id, ["c1", "c2"]);
    expect(inArray).toHaveBeenCalledWith(signalsTable.source, ["reddit", "jobs"]);
    expect(orderByMock).toHaveBeenCalledWith(desc(signalsTable.created_at), desc(signalsTable.id));
    expect(limitMock).toHaveBeenCalledWith(21);
    const sqlText = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(rawSqlText)
      .join(" ");
    expect((sql as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    expect(sqlText).toContain(">= ?");
    expect(sqlText).toContain("<= ?");
    expect(sqlText).toContain("< (?, ?::uuid)");
  });

  it("short-circuits empty signal filter arrays instead of calling inArray([])", async () => {
    await expect(listSignalFeed({ limit: 20, competitor_ids: [] })).resolves.toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("reads alerts with the same stable cursor ordering and a bounded lookahead", async () => {
    await listAlertFeed({
      limit: 10,
      competitor_ids: ["c1"],
      cursor: { created_at: new Date("2026-09-09T12:00:00.000Z"), id: "a1" },
    });

    expect(fromMock).toHaveBeenCalledWith(alertsTable);
    expect(inArray).toHaveBeenCalledWith(alertsTable.competitor_id, ["c1"]);
    expect(orderByMock).toHaveBeenCalledWith(desc(alertsTable.created_at), desc(alertsTable.id));
    expect(limitMock).toHaveBeenCalledWith(11);
  });

  // Math.floor(NaN) is NaN and survives Math.max/Math.min — an unparsed
  // `?limit=` must not reach the driver as a NaN LIMIT.
  it.each([
    ["signals", listSignalFeed],
    ["alerts", listAlertFeed],
  ])("clamps a non-finite %s limit to the default instead of passing NaN through", async (
    _label,
    listFeed
  ) => {
    await listFeed({ limit: Number.NaN });
    expect(limitMock).toHaveBeenCalledWith(26);

    await listFeed({ limit: 5_000 });
    expect(limitMock).toHaveBeenCalledWith(101);

    await listFeed({ limit: 0 });
    expect(limitMock).toHaveBeenCalledWith(2);
  });

  it("creates an alert with the full evidence artifact", async () => {
    const input = {
      competitor_id: "c1",
      run_id: "run-1",
      pattern: "pricing change",
      confidence: 0.9,
      evidence: [{ signal_id: "s1" }],
      interpretation: "The enterprise plan increased.",
      vulnerability_window_days: 14,
      recommended_actions: [{ action: "Update battlecard" }],
      supporting_cluster_ids: ["cluster-1"],
    };
    insertReturningMock.mockResolvedValue([{ id: "a1", ...input, delivered: false }]);

    const result = await createAlert(input);

    expect(insertMock).toHaveBeenCalledWith(alertsTable);
    expect(insertValuesMock).toHaveBeenCalledWith(input);
    expect(result.id).toBe("a1");
  });
});

describe("db/queries — competitor discovery write-back", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockReturnValue({ set: updateSetMock });
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue(undefined);
    insertMock.mockReturnValue({ values: insertValuesMock });
    insertValuesMock.mockResolvedValue(undefined);
    transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ update: updateMock, insert: insertMock })
    );
  });

  const mixedResult: CompetitorDiscoveryResult = {
    subreddits: ["r/acme"],
    greenhouse_token: "acmehq",
    lever_token: null,
    pricing_url: "https://acme.com/pricing",
    changelog_rss: null,
    logs: [
      {
        field_name: "subreddits",
        attempted_urls: ["https://reddit.com/r/acme"],
        discovered_value: "r/acme",
        status: "found",
        error_message: null,
      },
      {
        field_name: "greenhouse",
        attempted_urls: ["https://boards.greenhouse.io/acmehq"],
        discovered_value: "acmehq",
        status: "found",
        error_message: null,
      },
      {
        field_name: "lever",
        attempted_urls: ["https://jobs.lever.co/acme"],
        discovered_value: null,
        status: "not_found",
        error_message: null,
      },
      {
        field_name: "rss_url",
        attempted_urls: [],
        discovered_value: null,
        status: "error",
        error_message: "fetch timed out",
      },
    ],
  };

  it("updates the row to 'complete' and bulk-inserts one log row per attempt when ≥1 field was found", async () => {
    await finalizeDiscovery("c1", mixedResult);

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(competitorsTable);
    expect(updateSetMock).toHaveBeenCalledWith({
      subreddits: ["r/acme"],
      greenhouse_token: "acmehq",
      lever_token: null,
      pricing_url: "https://acme.com/pricing",
      changelog_rss: null,
      discovery_status: "complete",
      discovered_at: expect.any(Date),
      updated_at: expect.any(Date),
    });

    expect(insertMock).toHaveBeenCalledWith(competitorDiscoveryLogTable);
    const rows = (insertValuesMock.mock.calls[0][0]) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.competitor_id === "c1")).toBe(true);
    expect(rows.map((r) => r.field_name)).toEqual([
      "subreddits",
      "greenhouse",
      "lever",
      "rss_url",
    ]);
    expect(rows.map((r) => r.status)).toEqual(["found", "found", "not_found", "error"]);
    expect(rows[0].attempted_urls).toEqual(["https://reddit.com/r/acme"]);
    expect(rows[3].attempted_urls).toEqual([]);
    expect(rows[3].error_message).toBe("fetch timed out");
  });

  it("writes discovery_status 'failed' when the agent probed and found nothing usable", async () => {
    await finalizeDiscovery("c1", {
      subreddits: [],
      greenhouse_token: null,
      lever_token: null,
      pricing_url: null,
      changelog_rss: null,
      logs: mixedResult.logs.map((l) => ({
        ...l,
        status: l.status === "found" ? "not_found" : l.status,
        discovered_value: null,
      })),
    });

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ discovery_status: "failed" })
    );
    expect(insertMock).toHaveBeenCalledWith(competitorDiscoveryLogTable);
  });

  it("writes 'complete' when every probe missed but a pre-filled value survived", async () => {
    await finalizeDiscovery("c1", {
      subreddits: ["r/acme"],
      greenhouse_token: null,
      lever_token: null,
      pricing_url: null,
      changelog_rss: null,
      logs: [
        {
          field_name: "greenhouse",
          attempted_urls: ["https://boards.greenhouse.io/acme"],
          discovered_value: null,
          status: "not_found",
          error_message: null,
        },
      ],
    });

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ discovery_status: "complete" })
    );
  });

  it("writes 'complete' (not 'failed') when logs is empty — all fields were pre-filled", async () => {
    await finalizeDiscovery("c1", {
      subreddits: ["r/acme"],
      greenhouse_token: "acmehq",
      lever_token: null,
      pricing_url: "https://acme.com/pricing",
      changelog_rss: null,
      logs: [],
    });

    expect(updateMock).toHaveBeenCalledWith(competitorsTable);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ discovery_status: "complete" })
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("builds the update's .where from eq(competitorsTable.id, competitorId)", async () => {
    await finalizeDiscovery("c1", mixedResult);

    expect(eq).toHaveBeenCalledWith(competitorsTable.id, "c1");
    expect(updateWhereMock).toHaveBeenCalled();
  });
});
