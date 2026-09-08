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
  insertReturningMock: vi.fn(),
  updateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("./client", () => ({
  db: {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
    transaction: transactionMock,
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

import { eq, and, sql, asc, desc } from "drizzle-orm";
import {
  competitorsTable,
  competitorDiscoveryLogTable,
  signalsTable,
  competitorSignalScoresTable,
  agentLatenciesTable,
  companyProfileTable,
} from "./schema";
import {
  createCompetitor,
  getCompetitorById,
  listCompetitors,
  updateDiscoveryStatus,
  getCompetitorDiscoveryLog,
  getRecentSignalsByCompetitorAndSource,
  getSignalVolumeByDay,
  getLatestSignalScores,
  getLatencyPercentiles,
  getCompanyProfile,
  upsertCompanyProfile,
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

describe("db/queries — signal scores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
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
    it("updates the existing row when one is present", async () => {
      const existing = { id: "p1", product_description: "Old description" };
      const updated = { id: "p1", ...profileInput };
      limitMock.mockResolvedValue([existing]);
      updateReturningMock.mockResolvedValue([updated]);

      const result = await upsertCompanyProfile(profileInput);

      expect(transactionMock).toHaveBeenCalled();
      expect(updateMock).toHaveBeenCalledWith(companyProfileTable);
      expect(updateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({ ...profileInput, updated_at: expect.any(Date) })
      );
      expect(eq).toHaveBeenCalledWith(companyProfileTable.id, "p1");
      expect(insertMock).not.toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it("inserts a new row when the table is empty", async () => {
      const inserted = { id: "p2", ...profileInput };
      limitMock.mockResolvedValue([]);
      insertReturningMock.mockResolvedValue([inserted]);

      const result = await upsertCompanyProfile(profileInput);

      expect(transactionMock).toHaveBeenCalled();
      expect(insertMock).toHaveBeenCalledWith(companyProfileTable);
      expect(insertValuesMock).toHaveBeenCalledWith(profileInput);
      expect(updateMock).not.toHaveBeenCalled();
      expect(result).toEqual(inserted);
    });
  });
});
