import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/queries", () => ({
  getCompanyProfileForWorkspace: vi.fn(),
}));
vi.mock("@/lib/redis-client", () => ({
  cacheRedis: { get: vi.fn(), setex: vi.fn() },
}));
vi.mock("@/agents/discovery-search/memory-store", () => ({
  getSignalGoalMemory: vi.fn(),
}));
vi.mock("@/retrieval/hybrid-retrieval", () => ({
  hybridRetrieveProfile: vi.fn(),
}));

import { getCompanyProfileForWorkspace } from "@/db/queries";
import { cacheRedis } from "@/lib/redis-client";
import { getCompanyContext } from "@/lib/company-context";
import { getSignalGoalMemory } from "@/agents/discovery-search/memory-store";
import { hybridRetrieveProfile } from "@/retrieval/hybrid-retrieval";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000000";

const baseProfile = {
  workspace_id: WORKSPACE_ID,
  product_description: "Competitive intelligence platform",
  icp_company_size: "50-500 employees",
  icp_industries: ["B2B SaaS"],
  icp_buyer_role: "VP Product",
  pricing_tiers: [{ name: "Growth", price: 499, billing: "monthly" }],
  key_differentiators: ["Temporal fingerprinting", "No manual research"],
};

describe("getCompanyContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSignalGoalMemory).mockResolvedValue(null);
    vi.mocked(hybridRetrieveProfile).mockResolvedValue([]);
  });

  it("returns the cached string from Redis without querying Postgres", async () => {
    (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue("ABOUT THE USER'S COMPANY:\ncached");
    const context = await getCompanyContext(WORKSPACE_ID);
    expect(context).toBe("ABOUT THE USER'S COMPANY:\ncached");
    expect(getCompanyProfileForWorkspace).not.toHaveBeenCalled();
  });

  it("builds context from Postgres and caches it when Redis is empty", async () => {
    (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(getCompanyProfileForWorkspace).mockResolvedValue(baseProfile as never);

    const context = await getCompanyContext(WORKSPACE_ID);
    expect(context).toContain("Competitive intelligence platform");
    expect(context).toContain("VP Product");
    expect(getCompanyProfileForWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(cacheRedis.setex).toHaveBeenCalledWith(
      `company:profile:${WORKSPACE_ID}`,
      3600,
      expect.any(String)
    );
  });

  it("returns an empty string (not a throw) when no company_profile row exists", async () => {
    (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(getCompanyProfileForWorkspace).mockResolvedValue(null);

    const context = await getCompanyContext(WORKSPACE_ID);
    expect(context).toBe("");
  });

  it("scopes the Redis cache key by workspace", async () => {
    const workspaceA = "11111111-1111-1111-1111-111111111111";
    const workspaceB = "22222222-2222-2222-2222-222222222222";
    vi.mocked(getCompanyProfileForWorkspace).mockImplementation(async (id) =>
      id === workspaceA
        ? ({ ...baseProfile, workspace_id: workspaceA, product_description: "Product A" } as never)
        : ({ ...baseProfile, workspace_id: workspaceB, product_description: "Product B" } as never)
    );

    const contextA = await getCompanyContext(workspaceA);
    const contextB = await getCompanyContext(workspaceB);

    expect(contextA).toContain("Product A");
    expect(contextB).toContain("Product B");
    expect(contextA).not.toContain("Product B");
  });

  it("includes the signal goal and a doc-derived summary when both exist", async () => {
    vi.mocked(getSignalGoalMemory).mockResolvedValue({ goal: "catching up to Competitor X", confidence: 0.8 });
    vi.mocked(hybridRetrieveProfile).mockResolvedValue([{ id: "1", text: "We are bootstrapped." }] as never);

    const context = await getCompanyContext(WORKSPACE_ID);

    expect(context).toContain("Why this company uses Signal: catching up to Competitor X");
    expect(context).toContain("We are bootstrapped.");
  });
});
