import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  selectMock,
  fromMock,
  whereMock,
  orderByMock,
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

import { competitorsTable, competitorDiscoveryLogTable } from "./schema";
import {
  createCompetitor,
  getCompetitorById,
  listCompetitors,
  updateDiscoveryStatus,
  getCompetitorDiscoveryLog,
} from "./queries";

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
