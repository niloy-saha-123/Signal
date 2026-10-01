import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHART_CHROME,
  DIVERGING_COLORS,
  SCORE_DELTA_COLORS,
  SEQUENTIAL_COLOR,
  OTHER_SOURCE_COLOR,
  SOURCE_COLORS,
  STATUS_COLORS,
  chartSourceColor,
  sourceColor,
  sourceLabel,
} from "../../lib/chart-colors";

describe("lib/chart-colors", () => {
  it("assigns the eight validated categorical slots and folds the rest into Other on charts", () => {
    expect(SOURCE_COLORS.website).toBe("#2a78d6");
    expect(SOURCE_COLORS.reddit).toBe("#e34948");
    expect(chartSourceColor("github")).toBe(SOURCE_COLORS.github);
    expect(chartSourceColor("news")).toBe(OTHER_SOURCE_COLOR);
    expect(chartSourceColor("not-a-source")).toBe(OTHER_SOURCE_COLOR);
    expect(sourceColor("news")).toBe(SOURCE_COLORS.news);
    expect(sourceLabel("postings")).toBe("Newsroom");
    expect(sourceLabel("mystery")).toBe("mystery");
  });

  it("exposes the fixed status palette", () => {
    expect(STATUS_COLORS).toEqual({
      good: "#0a8a55",
      warning: "#f3b01d",
      serious: "#e97125",
      critical: "#cc3148",
    });
  });

  it("exposes the diverging pair", () => {
    expect(DIVERGING_COLORS).toEqual({
      positive: "#2a78d6",
      negative: "#e34948",
      neutral: "#eef3f7",
    });
  });

  it("exposes the sequential hue", () => {
    expect(SEQUENTIAL_COLOR).toBe("#2a78d6");
  });

  it("exposes chart chrome/ink tokens", () => {
    expect(CHART_CHROME).toEqual({
      surface: "#ffffff",
      inkPrimary: "#0f1d2b",
      inkSecondary: "#3d4f62",
      inkMuted: "#5a6b7d",
      gridline: "#e4ebf1",
      baseline: "#c8d6e2",
    });
  });

  it("maps Signal Score delta direction to the correct threat-semantics color (rising=critical, falling=good)", () => {
    expect(SCORE_DELTA_COLORS.rising).toBe(STATUS_COLORS.critical);
    expect(SCORE_DELTA_COLORS.falling).toBe(STATUS_COLORS.good);
  });

  it("keeps every source color identical to its CSS token, so charts and chips agree", () => {
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    for (const [source, hex] of Object.entries(SOURCE_COLORS)) {
      expect(css).toContain(`--color-source-${source}: ${hex};`);
    }
  });
});
