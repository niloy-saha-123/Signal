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
  deleteMock,
  deleteWhereMock,
  deleteReturningMock,
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
  deleteMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  deleteReturningMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
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
import { PgDialect } from "drizzle-orm/pg-core";
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
  llmCostsTable,
  signalPipelineOutboxTable,
  promptVersionsTable,
  agentTestCasesTable,
  ragEvalDatasetTable,
  ragEvalRunsTable,
  workspacesTable,
  workspaceMembersTable,
} from "@/db/schema";
import {
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
  getAgentLatencyReport,
  getCostByCompetitorDay,
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
  scoreSignalAndAdvanceOutbox,
  createClusterForSignalPair,
  getSignalClusterById,
  mergeSignalIntoCluster,
  completeAgentRun,
  failRunIfRunning,
  createAgentRun,
  finalizeDiscovery,
  listPendingSignalPipelineOutbox,
  advanceSignalPipelineOutbox,
  completeSignalPipelineOutbox,
  getPromptVersion,
  listAgentTestCases,
  promotePromptVersion,
  seedRagEvalDataset,
  RagEvalSeedConflictError,
  RagEvalSeedReferenceError,
  listRagEvalCases,
  getRagEvalCitationSignals,
  persistRagEvaluation,
  RagEvalDatasetIntegrityError,
  createWorkspace,
  getWorkspaceIdForUser,
  getCompetitorByIdForWorkspace,
  listCompetitorsForWorkspace,
  getCompetitorsByIdsForWorkspace,
  createCompetitorForWorkspace,
  getCompanyProfileForWorkspace,
  upsertCompanyProfileForWorkspace,
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

describe("db/queries — curated RAG seed ingestion", () => {
  const input = {
    id: "11111111-1111-4111-8111-111111111111",
    competitor_id: "22222222-2222-4222-8222-222222222222",
    category: "general" as const,
    question: "Exact curator question",
    expected_answer: "Exact curator answer",
    supporting_signal_ids: ["33333333-3333-4333-8333-333333333333"],
    confidence_level: "low" as const,
  };

  function arrangeExisting(persistedOverride: Record<string, unknown>) {
    const persisted = {
      id: input.id,
      competitor_id: input.competitor_id,
      category: input.category,
      question: input.question,
      expected_answer: input.expected_answer,
      supporting_chunk_ids: input.supporting_signal_ids,
      confidence_level: input.confidence_level,
      ...persistedOverride,
    };
    const returning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn((_rows: Array<{ id: string }>) => ({ onConflictDoNothing }));
    const orderBy = vi.fn(async () => [persisted]);
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: input.competitor_id }] })
        .mockResolvedValueOnce({ rows: [{ id: input.supporting_signal_ids[0], competitor_id: input.competitor_id }] }),
      insert: vi.fn(() => ({ values })),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy })) })) })),
    };
    transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));
  }

  it("inserts only seed-owned fields after locked, set-based reference validation", async () => {
    const persisted = {
      id: input.id,
      competitor_id: input.competitor_id,
      category: input.category,
      question: input.question,
      expected_answer: input.expected_answer,
      supporting_chunk_ids: input.supporting_signal_ids,
      confidence_level: input.confidence_level,
    };
    const returning = vi.fn(async () => [{ id: input.id }]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const orderBy = vi.fn(async () => [persisted]);
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: input.competitor_id }] })
        .mockResolvedValueOnce({ rows: [{ id: input.supporting_signal_ids[0], competitor_id: input.competitor_id }] }),
      insert: vi.fn(() => ({ values })),
      select: vi.fn(() => ({ from })),
    };
    transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));

    await expect(seedRagEvalDataset([input])).resolves.toEqual({ inserted: 1, unchanged: 0 });

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(tx.insert).toHaveBeenCalledWith(ragEvalDatasetTable);
    expect(values).toHaveBeenCalledWith([{
      id: input.id,
      competitor_id: input.competitor_id,
      category: input.category,
      question: input.question,
      expected_answer: input.expected_answer,
      supporting_chunk_ids: input.supporting_signal_ids,
      confidence_level: input.confidence_level,
    }]);
    expect(onConflictDoNothing).toHaveBeenCalledWith({ target: ragEvalDatasetTable.id });
    expect(orderBy).toHaveBeenCalledWith(asc(ragEvalDatasetTable.id));
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(tx.execute.mock.calls[0]![0]).params).toEqual([[input.competitor_id]]);
    expect(dialect.sqlToQuery(tx.execute.mock.calls[1]![0]).params).toEqual([
      [input.supporting_signal_ids[0]],
    ]);
    const referenceSql = tx.execute.mock.calls.map((call) => dialect.sqlToQuery(call[0]).sql);
    expect(referenceSql).toHaveLength(2);
    expect(referenceSql.every((statement) => statement.includes("ORDER BY") && statement.includes("FOR KEY SHARE"))).toBe(true);
    expect(referenceSql.join(" ")).toContain("ANY($1::uuid[])");
  });

  it("binds multiple reference IDs as uuid arrays and sorts insert rows by stable case ID", async () => {
    const second = {
      ...input,
      id: "00000000-0000-4000-8000-000000000000",
      competitor_id: "44444444-4444-4444-8444-444444444444",
      supporting_signal_ids: ["55555555-5555-4555-8555-555555555555"],
    };
    const persisted = [input, second].map((seedCase) => ({
      ...seedCase,
      supporting_chunk_ids: seedCase.supporting_signal_ids,
    }));
    const returning = vi.fn(async () => [{ id: input.id }, { id: second.id }]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn((_rows: Array<{ id: string }>) => ({ onConflictDoNothing }));
    const orderBy = vi.fn(async () => persisted);
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: second.competitor_id }, { id: input.competitor_id }] })
        .mockResolvedValueOnce({ rows: [
          { id: second.supporting_signal_ids[0], competitor_id: second.competitor_id },
          { id: input.supporting_signal_ids[0], competitor_id: input.competitor_id },
        ] }),
      insert: vi.fn(() => ({ values })),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy })) })) })),
    };
    transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));

    await expect(seedRagEvalDataset([input, second])).resolves.toEqual({ inserted: 2, unchanged: 0 });

    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(tx.execute.mock.calls[0]![0]).params).toEqual([
      [second.competitor_id, input.competitor_id].sort(),
    ]);
    expect(dialect.sqlToQuery(tx.execute.mock.calls[1]![0]).params).toEqual([
      [input.supporting_signal_ids[0], second.supporting_signal_ids[0]].sort(),
    ]);
    expect(values.mock.calls[0]![0].map((row: { id: string }) => row.id)).toEqual([second.id, input.id]);
  });

  it("rejects missing or cross-competitor references before any insert", async () => {
    const insert = vi.fn();
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: input.competitor_id }] })
        .mockResolvedValueOnce({ rows: [{ id: input.supporting_signal_ids[0], competitor_id: "99999999-9999-4999-8999-999999999999" }] }),
      insert,
      select: vi.fn(),
    };
    transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));

    await expect(seedRagEvalDataset([input])).rejects.toEqual(expect.objectContaining({
      name: "RagEvalSeedReferenceError", caseIds: [input.id],
    }));
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ["missing competitor", { competitors: [], signals: [{ id: input.supporting_signal_ids[0], competitor_id: input.competitor_id }] }],
    ["missing signal", { competitors: [{ id: input.competitor_id }], signals: [] }],
  ])("rejects %s without inserting", async (_label, rows) => {
    const insert = vi.fn();
    const tx = {
      execute: vi.fn().mockResolvedValueOnce({ rows: rows.competitors }).mockResolvedValueOnce({ rows: rows.signals }),
      insert,
      select: vi.fn(),
    };
    transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));

    await expect(seedRagEvalDataset([input])).rejects.toBeInstanceOf(RagEvalSeedReferenceError);
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ["competitor", { competitor_id: "99999999-9999-4999-8999-999999999999" }],
    ["nullable legacy competitor", { competitor_id: null }],
    ["category", { category: "pricing_history" }],
    ["question", { question: "Changed question" }],
    ["expected answer", { expected_answer: "Changed answer" }],
    ["nullable legacy support IDs", { supporting_chunk_ids: null }],
    ["confidence", { confidence_level: "high" }],
  ])("treats a changed %s as a no-overwrite conflict", async (_label, persistedOverride) => {
    arrangeExisting(persistedOverride);
    await expect(seedRagEvalDataset([input])).rejects.toMatchObject({
      name: "RagEvalSeedConflictError",
      conflictingIds: [input.id],
    });
  });

  it("treats an absent post-insert row as a conflict", async () => {
    const orderedInput = {
      ...input,
      supporting_signal_ids: [
        input.supporting_signal_ids[0],
        "44444444-4444-4444-8444-444444444444",
      ],
    };
    const returning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: input.competitor_id }] })
        .mockResolvedValueOnce({ rows: orderedInput.supporting_signal_ids.map((id) => ({ id, competitor_id: input.competitor_id })) }),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing })) })),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => []) })) })) })),
    };
    transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));
    await expect(seedRagEvalDataset([orderedInput])).rejects.toBeInstanceOf(RagEvalSeedConflictError);
  });

  it("treats support-ID order as seed-owned content", async () => {
    const orderedInput = {
      ...input,
      supporting_signal_ids: [
        input.supporting_signal_ids[0],
        "44444444-4444-4444-8444-444444444444",
      ],
    };
    const returning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const persisted = {
      ...orderedInput,
      supporting_chunk_ids: [...orderedInput.supporting_signal_ids].reverse(),
    };
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: input.competitor_id }] })
        .mockResolvedValueOnce({ rows: orderedInput.supporting_signal_ids.map((id) => ({ id, competitor_id: input.competitor_id })) }),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing })) })),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => [persisted]) })) })) })),
    };
    transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));
    await expect(seedRagEvalDataset([orderedInput])).rejects.toBeInstanceOf(RagEvalSeedConflictError);
  });

  it("reports deterministic conflicts while ignoring database-owned evaluation metadata", async () => {
    const persisted = {
      id: input.id,
      competitor_id: input.competitor_id,
      category: input.category,
      question: input.question,
      expected_answer: input.expected_answer,
      supporting_chunk_ids: input.supporting_signal_ids,
      confidence_level: input.confidence_level,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      last_evaluated_at: new Date("2026-02-01T00:00:00.000Z"),
      last_faithfulness_score: 0.99,
    };
    const returning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const orderBy = vi.fn(async () => [persisted]);
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: input.competitor_id }] })
        .mockResolvedValueOnce({ rows: [{ id: input.supporting_signal_ids[0], competitor_id: input.competitor_id }] }),
      insert: vi.fn(() => ({ values })),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy })) })) })),
    };
    transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));

    await expect(seedRagEvalDataset([input])).resolves.toEqual({ inserted: 0, unchanged: 1 });
  });

  it("rolls back a preceding insert when a later stable ID conflicts", async () => {
    const conflicting = { ...input, id: "44444444-4444-4444-8444-444444444444", question: "Different stored question" };
    let committed: Array<Record<string, unknown>> = [
      {
        id: conflicting.id, competitor_id: conflicting.competitor_id, category: conflicting.category,
        question: "Previously persisted question", expected_answer: conflicting.expected_answer,
        supporting_chunk_ids: conflicting.supporting_signal_ids, confidence_level: conflicting.confidence_level,
      },
    ];
    transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => {
      const working = structuredClone(committed);
      const orderBy = vi.fn(async () => working.sort((left, right) => String(left.id).localeCompare(String(right.id))));
      const returning = vi.fn(async () => {
        const rows = pending.filter((row) => !working.some((stored) => stored.id === row.id));
        working.push(...rows);
        return rows.map((row) => ({ id: row.id }));
      });
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      let pending: Array<Record<string, unknown>> = [];
      const tx = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: input.competitor_id }] })
          .mockResolvedValueOnce({ rows: [{ id: input.supporting_signal_ids[0], competitor_id: input.competitor_id }] }),
        insert: vi.fn(() => ({ values: vi.fn((rows) => { pending = rows; return { onConflictDoNothing }; }) })),
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy })) })) })),
      };
      const result = await callback(tx);
      committed = working;
      return result;
    });
    const before = structuredClone(committed);

    await expect(seedRagEvalDataset([input, conflicting])).rejects.toBeInstanceOf(RagEvalSeedConflictError);
    expect(committed).toEqual(before);
  });

  it("waits for both locked reference reads before inserting and reads back only after insert", async () => {
    let resolveCompetitor: ((value: { rows: Array<{ id: string }> }) => void) | undefined;
    let resolveSignal: ((value: { rows: Array<{ id: string; competitor_id: string }> }) => void) | undefined;
    const competitorRead = new Promise<{ rows: Array<{ id: string }> }>((resolve) => { resolveCompetitor = resolve; });
    const signalRead = new Promise<{ rows: Array<{ id: string; competitor_id: string }> }>((resolve) => { resolveSignal = resolve; });
    const events: string[] = [];
    const returning = vi.fn(async () => [{ id: input.id }]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const tx = {
      execute: vi.fn()
        .mockImplementationOnce(() => { events.push("competitor-read"); return competitorRead; })
        .mockImplementationOnce(() => { events.push("signal-read"); return signalRead; }),
      insert: vi.fn(() => { events.push("insert"); return { values }; }),
      select: vi.fn(() => {
        events.push("post-read");
        return { from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => [{
          id: input.id,
          competitor_id: input.competitor_id,
          category: input.category,
          question: input.question,
          expected_answer: input.expected_answer,
          supporting_chunk_ids: input.supporting_signal_ids,
          confidence_level: input.confidence_level,
        }]) })) })) };
      }),
    };
    transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));

    const seed = seedRagEvalDataset([input]);
    await Promise.resolve();
    expect(events).toEqual(["competitor-read", "signal-read"]);
    resolveCompetitor?.({ rows: [{ id: input.competitor_id }] });
    await Promise.resolve();
    expect(events).toEqual(["competitor-read", "signal-read"]);
    resolveSignal?.({ rows: [{ id: input.supporting_signal_ids[0], competitor_id: input.competitor_id }] });
    await expect(seed).resolves.toEqual({ inserted: 1, unchanged: 0 });
    expect(events).toEqual(["competitor-read", "signal-read", "insert", "post-read"]);
  });

  it.each(["insert", "post-read"] as const)(
    "propagates a %s failure and leaves the transaction's committed state unchanged",
    async (failurePoint) => {
      let committed: Array<Record<string, unknown>> = [];
      transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => {
        const working = structuredClone(committed);
        const returning = vi.fn(async () => {
          if (failurePoint === "insert") throw new Error("insert failure");
          working.push({ id: input.id });
          return [{ id: input.id }];
        });
        const onConflictDoNothing = vi.fn(() => ({ returning }));
        const tx = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ id: input.competitor_id }] })
            .mockResolvedValueOnce({ rows: [{ id: input.supporting_signal_ids[0], competitor_id: input.competitor_id }] }),
          insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing })) })),
          select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({
            orderBy: vi.fn(async () => {
              if (failurePoint === "post-read") throw new Error("post-read failure");
              return [];
            }),
          })) })) })),
        };
        const result = await callback(tx);
        committed = working;
        return result;
      });
      const before = structuredClone(committed);

      await expect(seedRagEvalDataset([input])).rejects.toThrow(
        failurePoint === "insert" ? "insert failure" : "post-read failure"
      );
      expect(committed).toEqual(before);
    }
  );
});

describe("db/queries — RAG faithfulness evaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
  });

  const datasetRow = {
    id: "11111111-1111-4111-8111-111111111111",
    competitor_id: "22222222-2222-4222-8222-222222222222",
    category: "general" as const,
    question: "Exact curator question",
    expected_answer: "Exact curator answer",
    supporting_signal_ids: ["33333333-3333-4333-8333-333333333333"],
    confidence_level: "low" as const,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
  };

  describe("listRagEvalCases", () => {
    it("orders by created_at then id and maps the legacy support column honestly", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockResolvedValue([datasetRow]);

      const result = await listRagEvalCases();

      expect(fromMock).toHaveBeenCalledWith(ragEvalDatasetTable);
      expect(orderByMock).toHaveBeenCalledWith(
        asc(ragEvalDatasetTable.created_at),
        asc(ragEvalDatasetTable.id)
      );
      expect(result).toEqual([datasetRow]);
    });

    it("filters by the exact competitor UUID when provided", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockResolvedValue([datasetRow]);

      await listRagEvalCases(datasetRow.competitor_id);

      expect(eq).toHaveBeenCalledWith(ragEvalDatasetTable.competitor_id, datasetRow.competitor_id);
      expect(whereMock).toHaveBeenCalledWith(eq(ragEvalDatasetTable.competitor_id, datasetRow.competitor_id));
    });

    it.each([
      ["null competitor_id", { competitor_id: null }],
      ["null support list", { supporting_signal_ids: null }],
      ["empty support list", { supporting_signal_ids: [] }],
      ["structural example question", { question: "STRUCTURAL EXAMPLE ONLY - placeholder" }],
      ["structural example expected answer", { expected_answer: "STRUCTURAL EXAMPLE ONLY - placeholder" }],
      ["invalid confidence level", { confidence_level: "extreme" }],
      ["non-UUID support id", { supporting_signal_ids: ["not-a-uuid"] }],
    ])("throws RagEvalDatasetIntegrityError for %s", async (_label, override) => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockResolvedValue([{ ...datasetRow, ...override }]);

      await expect(listRagEvalCases()).rejects.toBeInstanceOf(RagEvalDatasetIntegrityError);
    });
  });

  describe("getRagEvalCitationSignals", () => {
    it("returns [] without querying for an empty id list", async () => {
      const result = await getRagEvalCitationSignals([]);
      expect(result).toEqual([]);
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("hydrates via one set-based WHERE id IN (...) query and dedupes requested ids", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([
        { id: "s1", competitor_id: "c1", source: "reddit", title: "A title", raw_text: "raw text" },
        { id: "s2", competitor_id: "c1", source: "pricing", title: null, raw_text: "other text" },
      ]);

      const result = await getRagEvalCitationSignals(["s1", "s2", "s1"]);

      expect(fromMock).toHaveBeenCalledWith(signalsTable);
      expect(inArray).toHaveBeenCalledWith(signalsTable.id, ["s1", "s2"]);
      expect(result).toEqual([
        { id: "s1", competitor_id: "c1", source: "reddit", title: "A title", raw_text: "raw text" },
        { id: "s2", competitor_id: "c1", source: "pricing", title: "", raw_text: "other text" },
      ]);
    });
  });

  describe("persistRagEvaluation", () => {
    const runAt = new Date("2026-03-01T00:00:00.000Z");
    const answerResult = {
      response_type: "answer" as const,
      question_id: "11111111-1111-4111-8111-111111111111",
      question: "What is Acme's pricing?",
      category: "pricing_history" as const,
      answer: "Acme charges $10/month.",
      faithfulness_score: 1,
      passed: true,
      chunks_used: ["33333333-3333-4333-8333-333333333333"],
      failure_code: "none" as const,
      reasoning: "fully grounded",
    };
    const refusalResult = {
      response_type: "refusal" as const,
      question_id: "44444444-4444-4444-8444-444444444444",
      question: "What did Acme ship last week?",
      category: "product_change" as const,
      refusal_reason: "No evidence.",
      faithfulness_score: 0,
      passed: false,
      chunks_used: [] as [],
      failure_code: "unexpected_refusal" as const,
      reasoning: "seeded case incorrectly refused",
    };

    it("rejects an empty result set before starting a transaction", async () => {
      await expect(persistRagEvaluation({
        run_at: runAt, threshold: 0.75, ci_triggered: true, git_commit: "abc123", results: [],
      })).rejects.toThrow();
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it("recomputes totals/mean from validated results, updates case metadata set-based, and inserts one run", async () => {
      const executeMock = vi.fn().mockResolvedValue({
        rows: [{ id: answerResult.question_id }, { id: refusalResult.question_id }],
      });
      const insertReturning = vi.fn(async () => [{ id: "run-id-1" }]);
      const insertValues = vi.fn(() => ({ returning: insertReturning }));
      const tx = { execute: executeMock, insert: vi.fn(() => ({ values: insertValues })) };
      transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));

      const result = await persistRagEvaluation({
        run_at: runAt,
        threshold: 0.75,
        ci_triggered: true,
        git_commit: "abc123",
        results: [answerResult, refusalResult],
      });

      expect(transactionMock).toHaveBeenCalledOnce();
      expect(executeMock).toHaveBeenCalledOnce();
      expect(tx.insert).toHaveBeenCalledWith(ragEvalRunsTable);
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          run_at: runAt,
          total_questions: 2,
          passed: 1,
          failed: 1,
          faithfulness_score: 0.5,
          threshold: 0.75,
          ci_triggered: true,
          git_commit: "abc123",
        })
      );
      expect(result).toEqual({
        id: "run-id-1",
        summary: {
          run_at: runAt.toISOString(),
          total_questions: 2,
          passed: 1,
          failed: 1,
          faithfulness_score: 0.5,
          threshold: 0.75,
          ci_triggered: true,
          git_commit: "abc123",
        },
      });
    });

    it("ignores caller-supplied aggregates — an inconsistent passed flag never reaches the insert", async () => {
      const executeMock = vi.fn().mockResolvedValue({ rows: [{ id: answerResult.question_id }] });
      const insertReturning = vi.fn(async () => [{ id: "run-id-2" }]);
      const insertValues = vi.fn(() => ({ returning: insertReturning }));
      const tx = { execute: executeMock, insert: vi.fn(() => ({ values: insertValues })) };
      transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));

      await persistRagEvaluation({
        run_at: runAt, threshold: 0.75, ci_triggered: false, git_commit: null,
        results: [{ ...answerResult, faithfulness_score: 0.9 }],
      });

      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ total_questions: 1, passed: 1, failed: 0, faithfulness_score: 0.9 })
      );
    });

    it("throws and does not insert when a requested case id was deleted mid-evaluation", async () => {
      const executeMock = vi.fn().mockResolvedValue({ rows: [] });
      const insert = vi.fn();
      const tx = { execute: executeMock, insert };
      transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));

      await expect(persistRagEvaluation({
        run_at: runAt, threshold: 0.75, ci_triggered: true, git_commit: null, results: [answerResult],
      })).rejects.toThrow();
      expect(insert).not.toHaveBeenCalled();
    });

    it("rolls back the metadata update when the run insert fails", async () => {
      let committed: Array<{ id: string; score: number }> = [];
      transactionMock.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => {
        const working = structuredClone(committed);
        working.push({ id: answerResult.question_id, score: answerResult.faithfulness_score });
        const executeMock = vi.fn().mockResolvedValue({ rows: [{ id: answerResult.question_id }] });
        const insertReturning = vi.fn(async () => { throw new Error("insert failure"); });
        const tx = {
          execute: executeMock,
          insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertReturning })) })),
        };
        const result = await callback(tx);
        committed = working;
        return result;
      });
      const before = structuredClone(committed);

      await expect(persistRagEvaluation({
        run_at: runAt, threshold: 0.75, ci_triggered: true, git_commit: null, results: [answerResult],
      })).rejects.toThrow("insert failure");
      expect(committed).toEqual(before);
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
      // driver's actual type parsing here — instead we assert the ::int/::date
      // casts that make it produce real numbers/strings are present in the
      // query text. Without them: COUNT(*) comes back as bigint -> JS string
      // "3", and DATE_TRUNC on a timestamptz column comes back as a JS Date,
      // not a string, silently violating SignalVolumeByDay's declared types.
      // AT TIME ZONE 'UTC' pins the truncation boundary regardless of session
      // timezone (see the function's own comment) — GET /:id/trend joins this
      // day string exactly against an independently UTC-derived key.
      expect(
        rawTexts.some((t) => t.includes("DATE_TRUNC('day', ? AT TIME ZONE 'UTC')::date"))
      ).toBe(true);
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
      expect(rawTexts.some((t) => t.includes("::date"))).toBe(true);
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
    it("inserts the signal and initial outbox row in one transaction", async () => {
      const input = {
        competitor_id: "c1",
        source: "hn" as const,
        source_url: "https://news.ycombinator.com/item?id=1",
        title: "Acme raises Series B",
        raw_text: "Acme just raised a Series B",
      };
      const row = { id: "s1", ...input, quality_score: 0, collected_at: new Date(), created_at: new Date() };
      const signalValues = vi.fn(() => ({ returning: vi.fn(async () => [row]) }));
      const outboxValues = vi.fn(async () => undefined);
      transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ insert: insertMock })
      );
      insertMock.mockImplementation((table) => {
        if (table === signalsTable) {
          return { values: signalValues };
        }
        return { values: outboxValues };
      });

      const result = await createSignal(input);

      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(insertMock).toHaveBeenNthCalledWith(1, signalsTable);
      expect(insertMock).toHaveBeenNthCalledWith(2, signalPipelineOutboxTable);
      expect(signalValues).toHaveBeenCalledWith(input);
      expect(outboxValues).toHaveBeenCalledWith({ signal_id: "s1" });
      expect(result).toEqual(row);
    });

    it("rejects the transaction when the initial outbox write fails", async () => {
      const input = {
        competitor_id: "c1",
        source: "hn" as const,
        raw_text: "Acme changed",
      };
      const row = { id: "s1", ...input };
      transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ insert: insertMock })
      );
      insertMock.mockImplementation((table) => {
        if (table === signalsTable) {
          return { values: vi.fn(() => ({ returning: vi.fn(async () => [row]) })) };
        }
        return {
          values: vi.fn(async () => {
            throw new Error("outbox insert failed");
          }),
        };
      });

      await expect(createSignal(input)).rejects.toThrow("outbox insert failed");
      expect(transactionMock).toHaveBeenCalledTimes(1);
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

describe("db/queries — operational reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: whereMock });
    whereMock.mockReturnValue({ groupBy: groupByMock });
  });

  it("gets latency distribution and failure counts for every agent in one grouped query", async () => {
    const rows = [
      {
        agent_name: "synthesis",
        p50: 100,
        p95: 240,
        p99: 300,
        mean: 125.5,
        sample_count: 5,
        failed_count: 1,
        run_count: 5,
      },
    ];
    groupByMock.mockResolvedValue(rows);

    await expect(getAgentLatencyReport(14)).resolves.toEqual(rows);

    expect(fromMock).toHaveBeenCalledWith(agentLatenciesTable);
    expect(groupByMock).toHaveBeenCalledWith(agentLatenciesTable.agent_name);
    const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const rawTexts = sqlCalls.map(rawSqlText);
    expect(rawTexts.some((text) => text.includes("PERCENTILE_CONT(0.99)"))).toBe(true);
    expect(rawTexts.some((text) => text.includes("AVG("))).toBe(true);
    expect(rawTexts.some((text) => text.includes("FILTER (WHERE"))).toBe(true);
    const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
    expect(intervalCall!.at(-1)).toBe(14);
  });

  it("groups LLM cost by competitor and UTC day in one bounded query", async () => {
    const rows = [
      { competitor_id: "c1", day: "2026-09-10", cost_usd: 0.125 },
    ];
    groupByMock.mockResolvedValue(rows);

    await expect(getCostByCompetitorDay()).resolves.toEqual(rows);

    expect(fromMock).toHaveBeenCalledWith(llmCostsTable);
    expect(groupByMock).toHaveBeenCalledWith(
      llmCostsTable.competitor_id,
      expect.anything()
    );
    const sqlCalls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const rawTexts = sqlCalls.map(rawSqlText);
    expect(rawTexts.some((text) => text.includes("AT TIME ZONE 'UTC'"))).toBe(true);
    expect(rawTexts.some((text) => text.includes("SUM("))).toBe(true);
    const intervalCall = sqlCalls.find((call) => rawSqlText(call).includes("INTERVAL"));
    expect(intervalCall!.at(-1)).toBe(7);
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
    deleteMock.mockReturnValue({ where: deleteWhereMock });
    deleteWhereMock.mockReturnValue({ returning: deleteReturningMock });
  });

  describe("signal pipeline outbox", () => {
    it("lists a bounded oldest-first batch", async () => {
      const rows = [{ signal_id: "s1", stage: "entity_extraction" }];
      fromMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue(rows);

      await expect(listPendingSignalPipelineOutbox(25)).resolves.toEqual(rows);

      expect(fromMock).toHaveBeenCalledWith(signalPipelineOutboxTable);
      expect(orderByMock).toHaveBeenCalledWith(asc(signalPipelineOutboxTable.created_at));
      expect(limitMock).toHaveBeenCalledWith(25);
    });

    it("clamps malformed and oversized recovery batch limits", async () => {
      fromMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockReturnValue({ limit: limitMock });
      limitMock.mockResolvedValue([]);

      await listPendingSignalPipelineOutbox(Number.NaN);
      await listPendingSignalPipelineOutbox(10_000);

      expect(limitMock).toHaveBeenNthCalledWith(1, 100);
      expect(limitMock).toHaveBeenNthCalledWith(2, 500);
    });

    it("advances only from the expected stage with compare-and-set", async () => {
      updateWhereMock.mockReturnValue({ returning: updateReturningMock });
      updateReturningMock.mockResolvedValue([{ signal_id: "s1" }]);

      await expect(
        advanceSignalPipelineOutbox("s1", "entity_extraction", "quality_scoring")
      ).resolves.toBe(true);

      expect(updateMock).toHaveBeenCalledWith(signalPipelineOutboxTable);
      expect(updateSetMock).toHaveBeenCalledWith({
        stage: "quality_scoring",
        updated_at: expect.any(Date),
      });
      expect(and).toHaveBeenCalled();
      expect(eq).toHaveBeenCalledWith(signalPipelineOutboxTable.signal_id, "s1");
      expect(eq).toHaveBeenCalledWith(signalPipelineOutboxTable.stage, "entity_extraction");
    });

    it("reports a lost compare-and-set without pretending to advance", async () => {
      updateWhereMock.mockReturnValue({ returning: updateReturningMock });
      updateReturningMock.mockResolvedValue([]);

      await expect(
        advanceSignalPipelineOutbox("s1", "entity_extraction", "quality_scoring")
      ).resolves.toBe(false);
    });

    it("writes the quality score only when it atomically owns and advances the stage", async () => {
      transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ update: updateMock })
      );
      updateWhereMock
        .mockReturnValueOnce({ returning: updateReturningMock })
        .mockResolvedValueOnce(undefined);
      updateReturningMock.mockResolvedValueOnce([{ signal_id: "s1" }]);

      await expect(scoreSignalAndAdvanceOutbox("s1", 0.72)).resolves.toBe(true);

      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenNthCalledWith(1, signalPipelineOutboxTable);
      expect(updateSetMock).toHaveBeenNthCalledWith(1, {
        stage: "deduplication",
        updated_at: expect.any(Date),
      });
      expect(updateMock).toHaveBeenNthCalledWith(2, signalsTable);
      expect(updateSetMock).toHaveBeenNthCalledWith(2, { quality_score: 0.72 });
    });

    it("does not overwrite the score when a retry has lost stage ownership", async () => {
      transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ update: updateMock })
      );
      updateWhereMock.mockReturnValueOnce({ returning: updateReturningMock });
      updateReturningMock.mockResolvedValueOnce([]);

      await expect(scoreSignalAndAdvanceOutbox("s1", 0.81)).resolves.toBe(false);

      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledWith(signalPipelineOutboxTable);
    });

    it("completes only from the expected terminal stage", async () => {
      deleteReturningMock.mockResolvedValue([{ signal_id: "s1" }]);

      await expect(
        completeSignalPipelineOutbox("s1", "deduplication")
      ).resolves.toBe(true);

      expect(deleteMock).toHaveBeenCalledWith(signalPipelineOutboxTable);
      expect(and).toHaveBeenCalled();
      expect(eq).toHaveBeenCalledWith(signalPipelineOutboxTable.signal_id, "s1");
      expect(eq).toHaveBeenCalledWith(signalPipelineOutboxTable.stage, "deduplication");
    });
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
  const WORKSPACE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

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
      workspace_id: WORKSPACE_ID,
      competitor_ids: ["c1", "c2"],
      sources: ["reddit", "jobs"],
      min_quality: 0.6,
      created_after: new Date("2026-09-01T00:00:00.000Z"),
      created_before: new Date("2026-09-10T00:00:00.000Z"),
      cursor: { created_at: new Date("2026-09-09T12:00:00.000Z"), id: "s1" },
    });

    expect(fromMock).toHaveBeenCalledWith(signalsTable);
    // Workspace-scoping subquery predicate — always applied, ANDed with the
    // client-supplied competitor_ids filter (the actual vulnerability fix).
    expect(eq).toHaveBeenCalledWith(competitorsTable.workspace_id, WORKSPACE_ID);
    expect(inArray).toHaveBeenCalledWith(signalsTable.competitor_id, expect.anything());
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
    await expect(
      listSignalFeed({ limit: 20, workspace_id: WORKSPACE_ID, competitor_ids: [] })
    ).resolves.toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("reads alerts with the same stable cursor ordering and a bounded lookahead", async () => {
    await listAlertFeed({
      limit: 10,
      workspace_id: WORKSPACE_ID,
      competitor_ids: ["c1"],
      cursor: { created_at: new Date("2026-09-09T12:00:00.000Z"), id: "a1" },
    });

    expect(fromMock).toHaveBeenCalledWith(alertsTable);
    expect(eq).toHaveBeenCalledWith(competitorsTable.workspace_id, WORKSPACE_ID);
    expect(inArray).toHaveBeenCalledWith(alertsTable.competitor_id, expect.anything());
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
    await listFeed({ limit: Number.NaN, workspace_id: WORKSPACE_ID });
    expect(limitMock).toHaveBeenCalledWith(26);

    await listFeed({ limit: 5_000, workspace_id: WORKSPACE_ID });
    expect(limitMock).toHaveBeenCalledWith(101);

    await listFeed({ limit: 0, workspace_id: WORKSPACE_ID });
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

describe("db/queries — prompt evaluation and promotion", () => {
  const activePrompt = {
    id: "11111111-1111-4111-8111-111111111111",
    agent_name: "intent_analyzer",
    version: 1,
    prompt_text: "Active prompt",
    is_active: true,
    accuracy: 0.7,
    promoted_at: new Date("2026-09-01T00:00:00.000Z"),
    created_at: new Date("2026-08-01T00:00:00.000Z"),
  };
  const candidatePrompt = {
    id: "22222222-2222-4222-8222-222222222222",
    agent_name: "intent_analyzer",
    version: 2,
    prompt_text: "Candidate prompt",
    is_active: false,
    accuracy: null,
    promoted_at: null,
    created_at: new Date("2026-09-02T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    updateMock.mockReturnValue({ set: updateSetMock });
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateReturningMock.mockResolvedValue([{ id: "updated" }]);
  });

  it("loads a candidate by both agent name and version", async () => {
    fromMock.mockReturnValue({ where: whereMock });
    whereMock.mockReturnValue({ limit: limitMock });
    limitMock.mockResolvedValue([candidatePrompt]);

    await expect(getPromptVersion("intent_analyzer", 2)).resolves.toEqual(candidatePrompt);

    expect(fromMock).toHaveBeenCalledWith(promptVersionsTable);
    expect(eq).toHaveBeenCalledWith(promptVersionsTable.agent_name, "intent_analyzer");
    expect(eq).toHaveBeenCalledWith(promptVersionsTable.version, 2);
    expect(and).toHaveBeenCalled();
    expect(limitMock).toHaveBeenCalledWith(1);
  });

  it("loads same-agent cases in deterministic created-at and id order", async () => {
    const rows = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        agent_name: "intent_analyzer",
        input: { context: "x" },
        expected_output: { summary: "x", intent_level: "high" },
        created_at: new Date("2026-09-03T00:00:00.000Z"),
      },
    ];
    fromMock.mockReturnValue({ where: whereMock });
    whereMock.mockReturnValue({ orderBy: orderByMock });
    orderByMock.mockResolvedValue(rows);

    await expect(listAgentTestCases("intent_analyzer")).resolves.toEqual(rows);

    expect(fromMock).toHaveBeenCalledWith(agentTestCasesTable);
    expect(eq).toHaveBeenCalledWith(agentTestCasesTable.agent_name, "intent_analyzer");
    expect(orderByMock).toHaveBeenCalledWith(
      asc(agentTestCasesTable.created_at),
      asc(agentTestCasesTable.id)
    );
  });

  it("locks the complete agent prompt set with a bound agent value and stable order", async () => {
    const execute = vi.fn(async () => ({ rows: [activePrompt, candidatePrompt] }));
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ execute, update: updateMock })
    );

    await promotePromptVersion({
      agentName: "intent_analyzer",
      candidateVersion: 2,
      activeVersion: 1,
      candidate: { passed: 95, total: 100 },
      active: { passed: 70, total: 100 },
    });

    const lockCall = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      rawSqlText(call).includes("FOR UPDATE")
    );
    expect(lockCall).toBeDefined();
    const lockText = rawSqlText(lockCall!);
    expect(lockText).toContain("ORDER BY");
    expect(lockText).toContain("ASC");
    expect(lockText).not.toContain("intent_analyzer");
    expect(lockCall).toContain("intent_analyzer");
    expect(lockCall!.slice(-2)).toEqual([
      promptVersionsTable.version,
      promptVersionsTable.id,
    ]);
    expect(execute).toHaveBeenCalledOnce();
    expect(transactionMock).toHaveBeenCalledOnce();
  });

  it.each([
    [70, "not-better"],
    [60, "not-better"],
    [71, "not-significant"],
  ] as const)(
    "returns %s/100 as %s without issuing any update",
    async (candidatePassed, reason) => {
    const execute = vi.fn(async () => ({ rows: [activePrompt, candidatePrompt] }));
    const txUpdate = vi.fn();
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ execute, update: txUpdate })
    );

    await expect(
      promotePromptVersion({
        agentName: "intent_analyzer",
        candidateVersion: 2,
        activeVersion: 1,
        candidate: { passed: candidatePassed, total: 100 },
        active: { passed: 70, total: 100 },
      })
    ).resolves.toEqual(
      expect.objectContaining({
        promoted: false,
        reason,
        active_version: 1,
      })
    );
    expect(txUpdate).not.toHaveBeenCalled();
    }
  );

  it("rejects missing, already-active, and ambiguous candidate state without updating", async () => {
    const txUpdate = vi.fn();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [activePrompt] })
      .mockResolvedValueOnce({ rows: [{ ...candidatePrompt, is_active: true }] })
      .mockResolvedValueOnce({
        rows: [
          { ...activePrompt, id: "44444444-4444-4444-8444-444444444444" },
          { ...activePrompt, version: 3, id: "55555555-5555-4555-8555-555555555555" },
          candidatePrompt,
        ],
      })
      .mockResolvedValueOnce({ rows: [candidatePrompt] });
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ execute, update: txUpdate })
    );
    const baseInput = {
      agentName: "intent_analyzer" as const,
      activeVersion: 1,
      candidate: { passed: 95, total: 100 },
      active: { passed: 70, total: 100 },
    };

    await expect(
      promotePromptVersion({ ...baseInput, candidateVersion: 2 })
    ).rejects.toThrow("not found");
    await expect(
      promotePromptVersion({ ...baseInput, candidateVersion: 2 })
    ).rejects.toThrow("already active");
    await expect(
      promotePromptVersion({ ...baseInput, candidateVersion: 2 })
    ).rejects.toThrow("expected exactly one active version");
    await expect(
      promotePromptVersion({ ...baseInput, candidateVersion: 2 })
    ).rejects.toThrow("expected exactly one active version");
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it("validates audit counts before opening a transaction", async () => {
    await expect(
      promotePromptVersion({
        agentName: "intent_analyzer",
        candidateVersion: 2,
        activeVersion: 1,
        candidate: { passed: 11, total: 10 },
        active: { passed: 7, total: 10 },
      })
    ).rejects.toThrow();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("deactivates the locked active row before activating only the locked candidate", async () => {
    const execute = vi.fn(async () => ({ rows: [activePrompt, candidatePrompt] }));
    const txReturning = vi.fn().mockResolvedValue([{ id: "updated" }]);
    const txWhere = vi.fn(() => ({ returning: txReturning }));
    const txSet = vi.fn((_value: Record<string, unknown>) => ({ where: txWhere }));
    const txUpdate = vi.fn(() => ({ set: txSet }));
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ execute, update: txUpdate })
    );

    const result = await promotePromptVersion({
      agentName: "intent_analyzer",
      candidateVersion: 2,
      activeVersion: 1,
      candidate: { passed: 95, total: 100 },
      active: { passed: 70, total: 100 },
    });

    expect(txUpdate).toHaveBeenCalledTimes(2);
    expect(updateMock).not.toHaveBeenCalled();
    expect(txSet.mock.calls[0][0]).toEqual({ is_active: false });
    expect(txSet.mock.calls[1][0]).toEqual({
      is_active: true,
      accuracy: 0.95,
      promoted_at: expect.any(Date),
    });
    expect(eq).toHaveBeenCalledWith(promptVersionsTable.id, activePrompt.id);
    expect(eq).toHaveBeenCalledWith(promptVersionsTable.id, candidatePrompt.id);
    expect(eq).toHaveBeenCalledWith(promptVersionsTable.agent_name, "intent_analyzer");
    expect(eq).toHaveBeenCalledWith(promptVersionsTable.version, 2);
    expect(eq).toHaveBeenCalledWith(promptVersionsTable.is_active, true);
    expect(eq).toHaveBeenCalledWith(promptVersionsTable.is_active, false);
    expect(result).toEqual(
      expect.objectContaining({
        promoted: true,
        reason: "promoted",
        candidate_version: 2,
        active_version: 1,
        candidate_counts: { passed: 95, total: 100 },
        active_counts: { passed: 70, total: 100 },
      })
    );
  });

  it.each(["deactivation", "activation"] as const)(
    "keeps committed prompt state unchanged when %s throws",
    async (failurePoint) => {
    let committed = structuredClone([activePrompt, candidatePrompt]);
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const working = structuredClone(committed);
      let pendingSet: Record<string, unknown> = {};
      const returning = vi.fn(async () => {
        if (pendingSet.is_active === false) {
          if (failurePoint === "deactivation") {
            throw new Error("active deactivation failed");
          }
          const active = working.find((row) => row.is_active);
          if (!active) return [];
          active.is_active = false;
          return [{ id: active.id }];
        }
        throw new Error("candidate activation failed");
      });
      const where = vi.fn(() => ({ returning }));
      const set = vi.fn((value: Record<string, unknown>) => {
        pendingSet = value;
        return { where };
      });
      const tx = {
        execute: vi.fn(async () => ({ rows: working })),
        update: vi.fn(() => ({ set })),
      };
      const result = await callback(tx);
      committed = working;
      return result;
    });
    const before = structuredClone(committed);

    await expect(
      promotePromptVersion({
        agentName: "intent_analyzer",
        candidateVersion: 2,
        activeVersion: 1,
        candidate: { passed: 95, total: 100 },
        active: { passed: 70, total: 100 },
      })
    ).rejects.toThrow(
      failurePoint === "deactivation"
        ? "active deactivation failed"
        : "candidate activation failed"
    );

    expect(committed).toEqual(before);
    }
  );

  it("rejects a waiting different-candidate promotion when its audited active version is stale", async () => {
    const secondCandidatePrompt = {
      ...candidatePrompt,
      id: "66666666-6666-4666-8666-666666666666",
      version: 3,
      prompt_text: "Second candidate prompt",
    };
    let committed = structuredClone([
      activePrompt,
      candidatePrompt,
      secondCandidatePrompt,
    ]);
    let previousTransaction = Promise.resolve();
    let firstLockAcquired: (() => void) | undefined;
    const firstLocked = new Promise<void>((resolve) => {
      firstLockAcquired = resolve;
    });
    let allowFirstToContinue: (() => void) | undefined;
    const firstMayContinue = new Promise<void>((resolve) => {
      allowFirstToContinue = resolve;
    });
    let transactionNumber = 0;

    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const waitForPrevious = previousTransaction;
      let releaseCurrentTransaction: (() => void) | undefined;
      previousTransaction = new Promise<void>((resolve) => {
        releaseCurrentTransaction = resolve;
      });
      await waitForPrevious;

      const currentTransaction = transactionNumber++;
      const working = structuredClone(committed);
      let pendingSet: Record<string, unknown> = {};
      const returning = vi.fn(async () => {
        if (pendingSet.is_active === false) {
          const row = working.find((prompt) => prompt.is_active);
          if (!row) return [];
          row.is_active = false;
          return [{ id: row.id }];
        }
        const row = working.find((prompt) => prompt.version === currentTransaction + 2);
        if (!row || row.is_active) return [];
        Object.assign(row, pendingSet);
        return [{ id: row.id }];
      });
      const where = vi.fn(() => ({ returning }));
      const set = vi.fn((value: Record<string, unknown>) => {
        pendingSet = value;
        return { where };
      });
      const tx = {
        execute: vi.fn(async () => {
          if (currentTransaction === 0) {
            firstLockAcquired?.();
            await firstMayContinue;
          }
          return { rows: working };
        }),
        update: vi.fn(() => ({ set })),
      };

      try {
        const result = await callback(tx);
        committed = working;
        return result;
      } finally {
        releaseCurrentTransaction?.();
      }
    });

    const firstInput = {
      agentName: "intent_analyzer" as const,
      candidateVersion: 2,
      activeVersion: 1,
      candidate: { passed: 95, total: 100 },
      active: { passed: 70, total: 100 },
    };
    const secondInput = {
      agentName: "intent_analyzer" as const,
      candidateVersion: 3,
      activeVersion: 1,
      candidate: { passed: 80, total: 100 },
      active: { passed: 70, total: 100 },
    };
    const first = promotePromptVersion(firstInput);
    await firstLocked;
    const second = promotePromptVersion(secondInput);
    let secondSettled = false;
    void second.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      }
    );
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    allowFirstToContinue?.();
    await expect(first).resolves.toEqual(expect.objectContaining({ promoted: true }));
    await expect(second).rejects.toThrow("Active prompt version changed since evaluation");
    expect(committed.map(({ version, is_active }) => ({ version, is_active }))).toEqual([
      { version: 1, is_active: false },
      { version: 2, is_active: true },
      { version: 3, is_active: false },
    ]);
  });
});

describe("db/queries — workspaces", () => {
  const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
  const UNKNOWN_UUID = "22222222-2222-4222-8222-222222222222";
  const WS_UUID = "33333333-3333-4333-8333-333333333333";

  describe("createWorkspace", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("inserts a workspace and its owner membership row in one transaction", async () => {
      const workspaceRow = { id: WS_UUID, name: "Acme Inc", owner_id: OWNER_UUID, created_at: new Date() };
      const workspaceValues = vi.fn(() => ({ returning: vi.fn(async () => [workspaceRow]) }));
      const memberValues = vi.fn(async () => undefined);
      transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ insert: insertMock })
      );
      insertMock.mockImplementation((table) => {
        if (table === workspacesTable) {
          return { values: workspaceValues };
        }
        return { values: memberValues };
      });

      const result = await createWorkspace({ name: "Acme Inc", ownerId: OWNER_UUID });

      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(insertMock).toHaveBeenNthCalledWith(1, workspacesTable);
      expect(insertMock).toHaveBeenNthCalledWith(2, workspaceMembersTable);
      expect(workspaceValues).toHaveBeenCalledWith({ name: "Acme Inc", owner_id: OWNER_UUID });
      expect(memberValues).toHaveBeenCalledWith({
        workspace_id: WS_UUID,
        user_id: OWNER_UUID,
        role: "owner",
      });
      expect(result.name).toBe("Acme Inc");
      expect(result.owner_id).toBe(OWNER_UUID);
    });

    it("rejects the transaction when the owner membership insert fails", async () => {
      const workspaceRow = { id: WS_UUID, name: "Acme Inc", owner_id: OWNER_UUID };
      transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ insert: insertMock })
      );
      insertMock.mockImplementation((table) => {
        if (table === workspacesTable) {
          return { values: vi.fn(() => ({ returning: vi.fn(async () => [workspaceRow]) })) };
        }
        return {
          values: vi.fn(async () => {
            throw new Error("member insert failed");
          }),
        };
      });

      await expect(createWorkspace({ name: "Acme Inc", ownerId: OWNER_UUID })).rejects.toThrow(
        "member insert failed"
      );
    });
  });

  describe("getWorkspaceIdForUser", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      selectMock.mockReturnValue({ from: fromMock });
      fromMock.mockReturnValue({ where: whereMock });
    });

    it("returns the user's workspace id when a membership row exists", async () => {
      whereMock.mockResolvedValue([{ workspace_id: WS_UUID }]);

      const result = await getWorkspaceIdForUser(OWNER_UUID);

      expect(fromMock).toHaveBeenCalledWith(workspaceMembersTable);
      expect(eq).toHaveBeenCalledWith(workspaceMembersTable.user_id, OWNER_UUID);
      expect(result).toBe(WS_UUID);
    });

    it("returns null when the user has no membership", async () => {
      whereMock.mockResolvedValue([]);

      const result = await getWorkspaceIdForUser(UNKNOWN_UUID);

      expect(result).toBeNull();
    });
  });

});

describe("workspace-scoped competitor/profile queries", () => {
  const WS_A_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const WS_B_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const WS_WITHOUT_PROFILE_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const COMPETITOR_UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    insertMock.mockReturnValue({ values: insertValuesMock });
    insertValuesMock.mockReturnValue({ returning: insertReturningMock });
  });

  describe("getCompetitorByIdForWorkspace", () => {
    it("returns undefined for a competitor in a different workspace", async () => {
      // competitor row actually belongs to WS_A; and(id, workspace_id=WS_B) matches nothing
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([]);

      const result = await getCompetitorByIdForWorkspace(COMPETITOR_UUID, WS_B_UUID);

      expect(and).toHaveBeenCalled();
      expect(eq).toHaveBeenCalledWith(competitorsTable.id, COMPETITOR_UUID);
      expect(eq).toHaveBeenCalledWith(competitorsTable.workspace_id, WS_B_UUID);
      expect(result).toBeUndefined();
    });

    it("returns the row when id and workspace both match", async () => {
      const row = { id: COMPETITOR_UUID, workspace_id: WS_A_UUID, name: "Acme" };
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([row]);

      const result = await getCompetitorByIdForWorkspace(COMPETITOR_UUID, WS_A_UUID);

      expect(result).toEqual(row);
    });
  });

  describe("listCompetitorsForWorkspace", () => {
    it("only returns rows for that workspace", async () => {
      const rows = [
        { id: "c1", workspace_id: WS_A_UUID },
        { id: "c2", workspace_id: WS_A_UUID },
      ];
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockReturnValue({ orderBy: orderByMock });
      orderByMock.mockResolvedValue(rows);

      const results = await listCompetitorsForWorkspace(WS_A_UUID);

      expect(eq).toHaveBeenCalledWith(competitorsTable.workspace_id, WS_A_UUID);
      expect(orderByMock).toHaveBeenCalledWith(desc(competitorsTable.created_at));
      expect(results.every((c) => c.workspace_id === WS_A_UUID)).toBe(true);
    });
  });

  describe("getCompetitorsByIdsForWorkspace", () => {
    it("scopes the id lookup to the given workspace", async () => {
      const rows = [{ id: "c1", workspace_id: WS_A_UUID }];
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue(rows);

      const result = await getCompetitorsByIdsForWorkspace(["c1", "c2"], WS_A_UUID);

      expect(inArray).toHaveBeenCalledWith(competitorsTable.id, ["c1", "c2"]);
      expect(eq).toHaveBeenCalledWith(competitorsTable.workspace_id, WS_A_UUID);
      expect(and).toHaveBeenCalled();
      expect(result).toEqual(rows);
    });

    it("short-circuits an empty id array without querying", async () => {
      await expect(getCompetitorsByIdsForWorkspace([], WS_A_UUID)).resolves.toEqual([]);
      expect(selectMock).not.toHaveBeenCalled();
    });
  });

  describe("createCompetitorForWorkspace", () => {
    it("inserts with the caller's workspace_id and discovery_status defaulted to pending", async () => {
      const row = { id: "c1", workspace_id: WS_A_UUID, name: "Acme", domain: "acme.com" };
      insertReturningMock.mockResolvedValue([row]);

      const result = await createCompetitorForWorkspace(
        { name: "Acme", domain: "acme.com" },
        WS_A_UUID
      );

      expect(insertMock).toHaveBeenCalledWith(competitorsTable);
      expect(insertValuesMock).toHaveBeenCalledWith({
        workspace_id: WS_A_UUID,
        name: "Acme",
        domain: "acme.com",
        discovery_status: "pending",
      });
      expect(result).toEqual(row);
    });
  });

  describe("getCompanyProfileForWorkspace", () => {
    it("returns null when the workspace has no profile", async () => {
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([]);

      expect(await getCompanyProfileForWorkspace(WS_WITHOUT_PROFILE_UUID)).toBeNull();
      expect(eq).toHaveBeenCalledWith(companyProfileTable.workspace_id, WS_WITHOUT_PROFILE_UUID);
    });

    it("returns the workspace's profile row when one exists", async () => {
      const row = { id: "p1", workspace_id: WS_A_UUID, product_description: "A widget factory" };
      fromMock.mockReturnValue({ where: whereMock });
      whereMock.mockResolvedValue([row]);

      expect(await getCompanyProfileForWorkspace(WS_A_UUID)).toEqual(row);
    });
  });

  describe("upsertCompanyProfileForWorkspace", () => {
    // workspace_id here is deliberately the caller's own WS_A_UUID — the
    // function's second argument is the source of truth and always wins
    // (see the `set`/`values` assertions below), matching the brief's spread
    // order. Passing it inside profileInput just satisfies the (correctly)
    // required CompanyProfileInput type.
    const profileInput = {
      workspace_id: WS_A_UUID,
      product_description: "A widget factory",
      icp_company_size: "50-200",
      icp_industries: ["saas"],
      icp_buyer_role: "VP Eng",
      pricing_tiers: [{ name: "Pro", price: 99, billing: "monthly" }],
      key_differentiators: ["fast", "cheap"],
      primary_competitor_ids: ["c1"],
    };

    it("upserts keyed on the workspace_id unique index", async () => {
      const inserted = { id: "p1", ...profileInput };
      insertValuesMock.mockReturnValueOnce({ onConflictDoUpdate: onConflictDoUpdateMock });
      onConflictDoUpdateMock.mockReturnValueOnce({ returning: onConflictReturningMock });
      onConflictReturningMock.mockResolvedValueOnce([inserted]);

      const result = await upsertCompanyProfileForWorkspace(profileInput, WS_A_UUID);

      expect(insertMock).toHaveBeenCalledWith(companyProfileTable);
      expect(insertValuesMock).toHaveBeenCalledWith({ ...profileInput, workspace_id: WS_A_UUID });
      expect(onConflictDoUpdateMock).toHaveBeenCalledWith({
        target: companyProfileTable.workspace_id,
        set: { ...profileInput, updated_at: expect.any(Date) },
      });
      expect(result).toEqual(inserted);
    });
  });
});

describe("listSignalFeed / listAlertFeed workspace scoping", () => {
  const WS_A_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const OTHER_WORKSPACE_COMPETITOR_UUID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: whereMock });
    whereMock.mockReturnValue({ orderBy: orderByMock });
    orderByMock.mockReturnValue({ limit: limitMock });
    // The workspace-scoping subquery filters the (mocked) other-workspace id
    // out entirely — the real DB would return zero rows for this predicate
    // intersection, which this mock simulates directly.
    limitMock.mockResolvedValue([]);
  });

  it("excludes signals for a competitor_id outside the caller's workspace even when explicitly requested", async () => {
    const rows = await listSignalFeed({
      limit: 50,
      competitor_ids: [OTHER_WORKSPACE_COMPETITOR_UUID],
      workspace_id: WS_A_UUID,
    });

    expect(rows).toHaveLength(0);
    expect(eq).toHaveBeenCalledWith(competitorsTable.workspace_id, WS_A_UUID);
    expect(inArray).toHaveBeenCalledWith(signalsTable.competitor_id, expect.anything());
    expect(inArray).toHaveBeenCalledWith(signalsTable.competitor_id, [
      OTHER_WORKSPACE_COMPETITOR_UUID,
    ]);
    expect(and).toHaveBeenCalled();
  });

  it("excludes alerts for a competitor_id outside the caller's workspace even when explicitly requested", async () => {
    const rows = await listAlertFeed({
      limit: 50,
      competitor_ids: [OTHER_WORKSPACE_COMPETITOR_UUID],
      workspace_id: WS_A_UUID,
    });

    expect(rows).toHaveLength(0);
    expect(eq).toHaveBeenCalledWith(competitorsTable.workspace_id, WS_A_UUID);
    expect(inArray).toHaveBeenCalledWith(alertsTable.competitor_id, [
      OTHER_WORKSPACE_COMPETITOR_UUID,
    ]);
  });
});
