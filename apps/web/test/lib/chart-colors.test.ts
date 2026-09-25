import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHART_CHROME,
  DIVERGING_COLORS,
  SCORE_DELTA_COLORS,
  SEQUENTIAL_COLOR,
  SOURCE_COLORS,
  STATUS_COLORS,
} from "../../lib/chart-colors";

describe("lib/chart-colors", () => {
  it("exposes the nine signal-source categorical colors in the dataviz palette's fixed order", () => {
    expect(SOURCE_COLORS).toEqual({
      reddit: "#d06454",
      hn: "#cf7b00",
      jobs: "#3ca059",
      changelog: "#366bd3",
      pricing: "#c3639c",
      // GitHub's own mark is near-black; slate reads as the same family without
      // colliding with the five hues already assigned.
      github: "#49566c",
      website: "#9773d0",
      community: "#86962c",
      postings: "#009ca9",
    });
  });

  it("exposes the fixed status palette", () => {
    expect(STATUS_COLORS).toEqual({
      good: "#008039",
      warning: "#f3b01d",
      serious: "#e97125",
      critical: "#cc3148",
    });
  });

  it("exposes the diverging pair", () => {
    expect(DIVERGING_COLORS).toEqual({
      positive: "#2b61cc",
      negative: "#cc3148",
      neutral: "#f2f4f9",
    });
  });

  it("exposes the sequential hue", () => {
    expect(SEQUENTIAL_COLOR).toBe("#2b61cc");
  });

  it("exposes chart chrome/ink tokens", () => {
    expect(CHART_CHROME).toEqual({
      surface: "#ffffff",
      inkPrimary: "#0e1d3a",
      inkSecondary: "#485366",
      inkMuted: "#677181",
      gridline: "#e0e4eb",
      baseline: "#cad0d9",
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
