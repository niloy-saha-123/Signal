import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  selectMock,
  fromMock,
  whereMock,
  orderByMock,
  groupByMock,
  insertMock,
  insertValuesMock,
  insertReturningMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  whereMock: vi.fn(),
  orderByMock: vi.fn(),
  groupByMock: vi.fn(),
  insertMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  updateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock("./client", () => ({
  db: {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
  },
}));

// Spy on drizzle-orm's real eq/and/sql so we can assert the Drizzle call
// shape (which columns/values/raw-SQL text were used) without reimplementing
// SQL compilation in the test.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(actual.eq),
    and: vi.fn(actual.and),
    sql: Object.assign(vi.fn(actual.sql), actual.sql),
  };
});

import { eq, and, sql } from "drizzle-orm";
import { competitorsTable, competitorDiscoveryLogTable, signalsTable } from "./schema";
import {
  createCompetitor,
  getCompetitorById,
  listCompetitors,
  updateDiscoveryStatus,
  getCompetitorDiscoveryLog,
  getRecentSignalsByCompetitorAndSource,
  getSignalVolumeByDay,
} from "./queries";

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
      whereMock.mockResolvedValue(rows);

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
      expect(result).toEqual(rows);
    });

    it("honors a custom days window", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([]);

      await getRecentSignalsByCompetitorAndSource("c1", "reddit", 14);

      const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall!.at(-1)).toBe(14);
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
      expect(rawTexts.some((t) => t.includes("DATE_TRUNC('day', ?)"))).toBe(true);
      expect(rawTexts.some((t) => t === "COUNT(*)")).toBe(true);
      expect(rawTexts.some((t) => t.includes("SUM(?)"))).toBe(true);
      expect(rawTexts.some((t) => t.includes("NOW() - INTERVAL"))).toBe(true);

      const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
      expect(intervalCall!.at(-1)).toBe(30);

      expect(result).toEqual(rows);
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
