// apps/web/lib/chart-colors.ts
// Plain hex constants mirroring app/globals.css's @theme color tokens. Recharts takes raw
// color strings for stroke/fill, not Tailwind classNames — this file is the JS-side twin of
// the same v4 OKLCH-derived palette. A test keeps both identical;
// this is a small, stable palette, not worth a build-time token-sync pipeline.

export const SOURCE_COLORS = {
  reddit: "#d06454",
  hn: "#cf7b00",
  jobs: "#3ca059",
  changelog: "#366bd3",
  pricing: "#c3639c",
  github: "#49566c",
  website: "#9773d0",
  community: "#86962c",
  postings: "#009ca9",
} as const;

export const STATUS_COLORS = {
  good: "#008039",
  warning: "#f3b01d",
  serious: "#e97125",
  critical: "#cc3148",
} as const;

export const DIVERGING_COLORS = {
  positive: "#2b61cc",
  negative: "#cc3148",
  neutral: "#f2f4f9",
} as const;

export const SEQUENTIAL_COLOR = "#2b61cc";

export const CHART_CHROME = {
  surface: "#ffffff",
  inkPrimary: "#0e1d3a",
  inkSecondary: "#485366",
  inkMuted: "#677181",
  gridline: "#e0e4eb",
  baseline: "#cad0d9",
} as const;

// Signal Score is a competitor THREAT score — rising means the competitor is more active/
// threatening (bad for the user), falling means less threat (good). This is the inverse of
// the usual "up = green" stock-ticker convention — do not "fix" it to look more familiar.
export const SCORE_DELTA_COLORS = {
  rising: STATUS_COLORS.critical,
  falling: STATUS_COLORS.good,
} as const;
