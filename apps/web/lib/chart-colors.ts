// apps/web/lib/chart-colors.ts
// Plain hex constants mirroring app/globals.css's @theme color tokens. Recharts takes raw
// color strings for stroke/fill, not Tailwind classNames — this file is the JS-side twin of
// the same palette (dataviz skill's validated reference instance). Keep both in sync by hand;
// this is a small, stable palette, not worth a build-time token-sync pipeline.

export const SOURCE_COLORS = {
  reddit: "#2a78d6",
  hn: "#eb6834",
  jobs: "#1baf7a",
  changelog: "#eda100",
  pricing: "#e87ba4",
  github: "#4b5563",
  website: "#9a6a3a",
  community: "#7a8b2e",
  postings: "#1c9aa8",
} as const;

export const STATUS_COLORS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

export const DIVERGING_COLORS = {
  positive: "#2a78d6",
  negative: "#e34948",
  neutral: "#f0efec",
} as const;

export const SEQUENTIAL_COLOR = "#2a78d6";

export const CHART_CHROME = {
  surface: "#fcfcfb",
  inkPrimary: "#0b0b0b",
  inkSecondary: "#52514e",
  inkMuted: "#898781",
  gridline: "#e1e0d9",
  baseline: "#c3c2b7",
} as const;

// Signal Score is a competitor THREAT score — rising means the competitor is more active/
// threatening (bad for the user), falling means less threat (good). This is the inverse of
// the usual "up = green" stock-ticker convention — do not "fix" it to look more familiar.
export const SCORE_DELTA_COLORS = {
  rising: STATUS_COLORS.critical,
  falling: STATUS_COLORS.good,
} as const;
