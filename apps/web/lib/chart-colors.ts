// apps/web/lib/chart-colors.ts
// JS-side twin of the colour tokens in app/globals.css. Recharts takes raw colour
// strings, not Tailwind classes. Keep both in sync by hand; a test enforces it.
import type { SignalSource } from "@signal/shared";

// Slots 1–8 follow the dataviz skill's validated categorical order. Sources past
// slot 8 must fold into "Other" on charts (see chartSourceColor) — never a ninth
// hue on the same plot. Chips always print the source name next to the dot.
export const SOURCE_COLORS = {
  website: "#2a78d6",
  hn: "#eb6834",
  jobs: "#1baf7a",
  changelog: "#eda100",
  pricing: "#e87ba4",
  community: "#008300",
  github: "#4a3aa7",
  reddit: "#e34948",
  postings: "#1c9aa8",
  news: "#3d5a99",
  docs: "#7a8b2e",
  packages: "#9a6a3a",
  field: "#6b7686",
  blog: "#8b5e34",
  social: "#b5179e",
} as const;

export const OTHER_SOURCE_COLOR = "#8a97a6";

const CHART_SLOTS = new Set(["website", "hn", "jobs", "changelog", "pricing", "community", "github", "reddit"]);

export function sourceColor(source: string): string {
  return (SOURCE_COLORS as Record<string, string>)[source] ?? OTHER_SOURCE_COLOR;
}

// For plots: only the eight validated slots keep their hue; everything else is "Other".
export function chartSourceColor(source: SignalSource | string): string {
  return CHART_SLOTS.has(source) ? sourceColor(source) : OTHER_SOURCE_COLOR;
}

export const SOURCE_LABELS: Record<string, string> = {
  website: "Website",
  hn: "Hacker News",
  jobs: "Jobs",
  changelog: "Changelog",
  pricing: "Pricing",
  community: "Community",
  github: "GitHub",
  reddit: "Reddit",
  postings: "Newsroom",
  news: "News",
  docs: "Docs",
  packages: "Packages",
  field: "From your team",
  blog: "Blog",
  social: "Social",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export const STATUS_COLORS = {
  good: "#0a8a55",
  warning: "#f3b01d",
  serious: "#e97125",
  critical: "#cc3148",
} as const;

export const DIVERGING_COLORS = {
  positive: "#2a78d6",
  negative: "#e34948",
  neutral: "#eef3f7",
} as const;

export const SEQUENTIAL_COLOR = "#2a78d6";

export const CHART_CHROME = {
  surface: "#ffffff",
  inkPrimary: "#0f1d2b",
  inkSecondary: "#3d4f62",
  inkMuted: "#5a6b7d",
  gridline: "#e4ebf1",
  baseline: "#c8d6e2",
} as const;

// Signal Score is a competitor THREAT score — rising means the competitor is more
// active (bad for the user). Inverse of the stock-ticker convention on purpose.
export const SCORE_DELTA_COLORS = {
  rising: STATUS_COLORS.critical,
  falling: STATUS_COLORS.good,
} as const;
