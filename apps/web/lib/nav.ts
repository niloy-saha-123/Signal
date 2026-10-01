import type { IconName } from "@/components/ui/icons";

// One navigation model for the sidebar, the mobile menu and the ⌘K palette.
// Six destinations, each answering one question. Older routes stay reachable and
// light up their parent: /scorecard is part of Forecasts, /discovery and
// /radar/:id are part of Competitors, /alerts is part of Evidence.
export interface NavItem {
  href: string;
  label: string;
  hint: string;
  icon: IconName;
  matches: string[];
}

export const PRIMARY_NAV: NavItem[] = [
  { href: "/briefing", label: "Home", hint: "What moved and what to do", icon: "home", matches: ["/briefing"] },
  {
    href: "/forecast",
    label: "Forecasts",
    hint: "What Signal expects next, and its track record",
    icon: "forecast",
    matches: ["/forecast", "/scorecard"],
  },
  {
    href: "/board",
    label: "Competitors",
    hint: "Profiles, scores and candidates",
    icon: "competitors",
    matches: ["/board", "/radar", "/discovery"],
  },
  {
    href: "/intel",
    label: "Evidence",
    hint: "Every signal collected, and alerts",
    icon: "evidence",
    matches: ["/intel", "/alerts"],
  },
  { href: "/chat", label: "Ask Signal", hint: "Questions answered from evidence", icon: "chat", matches: ["/chat"] },
  {
    href: "/company",
    label: "Your company",
    hint: "Context that makes advice specific",
    icon: "company",
    matches: ["/company"],
  },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", hint: "Workspace, Slack, MCP, budget", icon: "settings", matches: ["/settings"] },
  { href: "/activity", label: "Activity", hint: "What the agents are doing", icon: "activity", matches: ["/activity"] },
];

export const NAV_ITEMS: NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

export function isActive(pathname: string, item: NavItem | string): boolean {
  const prefixes = typeof item === "string" ? [item] : item.matches;
  return prefixes.some((href) => pathname === href || pathname.startsWith(`${href}/`));
}
