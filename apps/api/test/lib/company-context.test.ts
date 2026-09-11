import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({
  db: { select: vi.fn() },
}));
vi.mock("@/lib/redis-client", () => ({
  cacheRedis: { get: vi.fn(), setex: vi.fn() },
}));

import { db } from "@/db/client";
import { cacheRedis } from "@/lib/redis-client";
import { getCompanyContext } from "@/lib/company-context";

describe("getCompanyContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the cached string from Redis without querying Postgres", async () => {
    (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue("ABOUT THE USER'S COMPANY:\ncached");
    const context = await getCompanyContext();
    expect(context).toBe("ABOUT THE USER'S COMPANY:\ncached");
    expect(db.select).not.toHaveBeenCalled();
  });

  it("builds context from Postgres and caches it when Redis is empty", async () => {
    (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          {
            product_description: "Competitive intelligence platform",
            icp_company_size: "50-500 employees",
            icp_industries: ["B2B SaaS"],
            icp_buyer_role: "VP Product",
            pricing_tiers: [{ name: "Growth", price: 499, billing: "monthly" }],
            key_differentiators: ["Temporal fingerprinting", "No manual research"],
          },
        ]),
      }),
    });

    const context = await getCompanyContext();
    expect(context).toContain("Competitive intelligence platform");
    expect(context).toContain("VP Product");
    expect(cacheRedis.setex).toHaveBeenCalledWith("company:profile", 3600, expect.any(String));
  });

  it("returns an empty string (not a throw) when no company_profile row exists", async () => {
    (cacheRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    });

    const context = await getCompanyContext();
    expect(context).toBe("");
  });
});
