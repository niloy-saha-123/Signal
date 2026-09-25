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
  it("exposes the six signal-source categorical colors in the dataviz palette's fixed order", () => {
    expect(SOURCE_COLORS).toEqual({
      reddit: "#2a78d6",
      hn: "#eb6834",
      jobs: "#1baf7a",
      changelog: "#eda100",
      pricing: "#e87ba4",
      // GitHub's own mark is near-black; slate reads as the same family without
      // colliding with the five hues already assigned.
      github: "#4b5563",
    });
  });

  it("exposes the fixed status palette", () => {
    expect(STATUS_COLORS).toEqual({
      good: "#0ca30c",
      warning: "#fab219",
      serious: "#ec835a",
      critical: "#d03b3b",
    });
  });

  it("exposes the diverging pair", () => {
    expect(DIVERGING_COLORS).toEqual({
      positive: "#2a78d6",
      negative: "#e34948",
      neutral: "#f0efec",
    });
  });

  it("exposes the sequential hue", () => {
    expect(SEQUENTIAL_COLOR).toBe("#2a78d6");
  });

  it("exposes chart chrome/ink tokens", () => {
    expect(CHART_CHROME).toEqual({
      surface: "#fcfcfb",
      inkPrimary: "#0b0b0b",
      inkSecondary: "#52514e",
      inkMuted: "#898781",
      gridline: "#e1e0d9",
      baseline: "#c3c2b7",
    });
  });

  it("maps Signal Score delta direction to the correct threat-semantics color (rising=critical, falling=good)", () => {
    expect(SCORE_DELTA_COLORS.rising).toBe(STATUS_COLORS.critical);
    expect(SCORE_DELTA_COLORS.falling).toBe(STATUS_COLORS.good);
  });
});
