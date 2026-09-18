// Tool registry tests — per-tool schema validation, correct delegation to the
// underlying query/route logic, and the mutating flag. All deps are fakes so no
// Postgres/Redis/registry is touched.
import { describe, expect, it, vi } from "vitest";
import { buildChatTools, describeMutation, type ChatTool, type ChatToolDeps } from "@/agents/chat/tools";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000000";
const COMPETITOR_ID = "11111111-1111-4111-8111-111111111111";
const GOAL_ID = "22222222-2222-4222-8222-222222222222";

function fakeDeps(overrides: Partial<ChatToolDeps> = {}): ChatToolDeps {
  return {
    listCompetitorsForWorkspace: vi.fn().mockResolvedValue([]),
    getCompetitorByIdForWorkspace: vi.fn().mockResolvedValue({ id: COMPETITOR_ID, name: "Acme", domain: "acme.com", is_active: true }),
    getLatestSignalScores: vi.fn().mockResolvedValue([]),
    getSignalVolumeByDay: vi.fn().mockResolvedValue([]),
    createCompetitorForWorkspace: vi.fn().mockResolvedValue({ id: COMPETITOR_ID, name: "Acme", domain: "acme.com" }),
    createAgentRun: vi.fn().mockResolvedValue({ id: "run-1" }),
    failRunIfRunning: vi.fn().mockResolvedValue(undefined),
    getRecentPricingDiffs: vi.fn().mockResolvedValue([]),
    listCompanyGoalsForWorkspace: vi.fn().mockResolvedValue([]),
    createCompanyGoal: vi.fn().mockResolvedValue({ id: GOAL_ID }),
    updateCompanyGoal: vi.fn().mockResolvedValue({ id: GOAL_ID }),
    enqueue: vi.fn().mockResolvedValue(undefined),
    enqueueDiscovery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function registry(deps: ChatToolDeps): Map<string, ChatTool> {
  return new Map(buildChatTools(WORKSPACE_ID, deps).map((t) => [t.name, t]));
}

describe("agents/chat/tools — registry shape", () => {
  it("exposes 8 tools with the expected mutating flags", () => {
    const tools = buildChatTools(WORKSPACE_ID, fakeDeps());
    expect(tools.map((t) => [t.name, t.mutating])).toEqual([
      ["list_competitors", false],
      ["get_competitor_score", false],
      ["get_competitor_trend", false],
      ["list_company_goals", false],
      ["create_competitor", true],
      ["trigger_competitor_analysis", true],
      ["update_company_goals", true],
      ["trigger_discovery_search", true],
    ]);
  });
});

describe("agents/chat/tools — read tools", () => {
  it("list_competitors delegates to the workspace-scoped query and returns JSON", async () => {
    const deps = fakeDeps({
      listCompetitorsForWorkspace: vi.fn().mockResolvedValue([
        { id: COMPETITOR_ID, name: "Acme", domain: "acme.com", is_active: true },
      ]),
    });
    const result = await registry(deps).get("list_competitors")!.tool.invoke({});
    expect(deps.listCompetitorsForWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(JSON.parse(result as string)).toEqual([
      { id: COMPETITOR_ID, name: "Acme", domain: "acme.com", is_active: true },
    ]);
  });

  it("get_competitor_score requires a UUID and scopes through getCompetitorByIdForWorkspace", async () => {
    const deps = fakeDeps({
      getLatestSignalScores: vi.fn().mockResolvedValue([
        { id: "s1", competitor_id: COMPETITOR_ID, score: 82, components: {}, delta_7d: 1.5, delta_30d: 2, computed_at: new Date("2026-09-17") },
      ]),
    });
    const tool = registry(deps).get("get_competitor_score")!.tool;
    const result = await tool.invoke({ competitor_id: COMPETITOR_ID });
    expect(deps.getCompetitorByIdForWorkspace).toHaveBeenCalledWith(COMPETITOR_ID, WORKSPACE_ID);
    expect(JSON.parse(result as string)).toMatchObject({ score: 82, delta_7d: 1.5 });
    await expect(tool.invoke({ competitor_id: "not-a-uuid" })).rejects.toThrow();
  });

  it("get_competitor_score returns a honest no-match message for a foreign competitor id", async () => {
    const deps = fakeDeps({ getCompetitorByIdForWorkspace: vi.fn().mockResolvedValue(undefined) });
    const result = await registry(deps).get("get_competitor_score")!.tool.invoke({ competitor_id: COMPETITOR_ID });
    expect(result).toContain("no competitor with that id");
    expect(deps.getLatestSignalScores).not.toHaveBeenCalled();
  });

  it("list_company_goals delegates to listCompanyGoalsForWorkspace", async () => {
    const deps = fakeDeps({
      listCompanyGoalsForWorkspace: vi.fn().mockResolvedValue([
        { id: GOAL_ID, content: "Expand to SMB", status: "active", created_by: "user" },
      ]),
    });
    const result = await registry(deps).get("list_company_goals")!.tool.invoke({});
    expect(deps.listCompanyGoalsForWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(JSON.parse(result as string)).toEqual([
      { id: GOAL_ID, content: "Expand to SMB", status: "active", created_by: "user" },
    ]);
  });
});

describe("agents/chat/tools — mutating tools", () => {
  it("create_competitor reuses CompetitorCreateInputSchema (name+domain required) and enqueues discovery", async () => {
    const deps = fakeDeps();
    const tool = registry(deps).get("create_competitor")!.tool;
    const result = await tool.invoke({ name: "Acme", domain: "acme.com" });
    expect(deps.createCompetitorForWorkspace).toHaveBeenCalledWith(
      { name: "Acme", domain: "acme.com" },
      WORKSPACE_ID
    );
    expect(deps.enqueue).toHaveBeenCalledWith("competitor-discovery", {
      competitor_id: COMPETITOR_ID,
      name: "Acme",
      domain: "acme.com",
    });
    expect(result).toContain("created competitor Acme");
    await expect(tool.invoke({ name: "Acme" })).rejects.toThrow();
  });

  it("update_company_goals create persists with created_by='agent'", async () => {
    const deps = fakeDeps();
    const result = await registry(deps).get("update_company_goals")!.tool.invoke({
      action: "create",
      content: "Launch an API platform",
    });
    expect(deps.createCompanyGoal).toHaveBeenCalledWith(WORKSPACE_ID, "Launch an API platform", "agent");
    expect(result).toBe("created goal");
  });

  it("update_company_goals archive routes through updateCompanyGoal with status archived", async () => {
    const deps = fakeDeps();
    await registry(deps).get("update_company_goals")!.tool.invoke({ action: "archive", goal_id: GOAL_ID });
    expect(deps.updateCompanyGoal).toHaveBeenCalledWith(GOAL_ID, WORKSPACE_ID, { status: "archived" });
  });

  it("trigger_discovery_search enqueues a discovery run via enqueueDiscovery", async () => {
    const deps = fakeDeps();
    const result = await registry(deps).get("trigger_discovery_search")!.tool.invoke({
      goal: "find project-management competitors",
    });
    expect(deps.enqueueDiscovery).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(result).toContain("started a discovery search");
  });

  it("trigger_competitor_analysis creates a run and enqueues analysis", async () => {
    const deps = fakeDeps({
      createAgentRun: vi.fn().mockResolvedValue({ id: "run-1" }),
      getRecentPricingDiffs: vi.fn().mockResolvedValue([{ id: "d1" }]),
    });
    await registry(deps).get("trigger_competitor_analysis")!.tool.invoke({ competitor_id: COMPETITOR_ID });
    expect(deps.createAgentRun).toHaveBeenCalledWith({ competitor_id: COMPETITOR_ID, trigger: "manual" });
    expect(deps.enqueue).toHaveBeenCalledWith("analysis", {
      competitor_id: COMPETITOR_ID,
      workspace_id: WORKSPACE_ID,
      run_id: "run-1",
      has_pricing_diff: true,
    });
  });
});

describe("agents/chat/tools — describeMutation", () => {
  it("renders a human-readable create competitor line", () => {
    expect(describeMutation("create_competitor", { name: "Acme", domain: "acme.com" })).toBe(
      'Create competitor "Acme" (acme.com) and start discovery?'
    );
  });

  it("renders a human-readable add-goal line", () => {
    expect(describeMutation("update_company_goals", { action: "create", content: "Expand to SMB" })).toBe(
      'Add company goal: "Expand to SMB"?'
    );
  });
});