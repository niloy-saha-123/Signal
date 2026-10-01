// Small display helpers shared across app pages. Dates render in UTC with a
// fixed locale so server and client output match (no hydration drift).

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : DATE.format(date);
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : SHORT_DATE.format(date);
}

export function daysUntil(iso: string, now: number = Date.now()): number {
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatShortDate(iso);
}

// "pricing_packaging_split" → "Pricing packaging split"
export function humanizePattern(pattern: string): string {
  const text = pattern.replace(/[_-]+/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Signal";
}

export const PATTERN_LABEL: Record<string, string> = {
  product_launch: "Product launch",
  pricing_change: "Pricing change",
  upmarket_pivot: "Upmarket pivot",
  platform_expansion: "Platform expansion",
  hiring_surge: "Hiring surge",
  deprecation: "Deprecation",
};

export function patternLabel(pattern: string): string {
  return PATTERN_LABEL[pattern] ?? humanizePattern(pattern);
}

export function greeting(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function pct(probability: number): string {
  return `${Math.round(Math.min(1, Math.max(0, probability)) * 100)}%`;
}
