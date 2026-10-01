import { describe, expect, it } from "vitest";
import { NAV_ITEMS, PRIMARY_NAV, isActive } from "../../lib/nav";

const item = (label: string) => NAV_ITEMS.find((i) => i.label === label)!;

describe("nav", () => {
  it("keeps the primary navigation to six destinations", () => {
    expect(PRIMARY_NAV).toHaveLength(6);
  });

  it("lights up the parent for routes folded under it", () => {
    expect(isActive("/scorecard", item("Forecasts"))).toBe(true);
    expect(isActive("/forecast/abc", item("Forecasts"))).toBe(true);
    expect(isActive("/radar/123", item("Competitors"))).toBe(true);
    expect(isActive("/discovery", item("Competitors"))).toBe(true);
    expect(isActive("/alerts", item("Evidence"))).toBe(true);
  });

  it("does not match on a shared prefix that is not a path segment", () => {
    expect(isActive("/boardroom", item("Competitors"))).toBe(false);
    expect(isActive("/briefing", item("Forecasts"))).toBe(false);
  });

  it("still accepts a plain href", () => {
    expect(isActive("/settings/slack", "/settings")).toBe(true);
  });
});
