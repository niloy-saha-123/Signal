import type { IconName } from "@/components/ui/icons";

// One navigation model for the sidebar, the mobile menu and the ⌘K palette.
// Grouped by the question each surface answers: Forecast leads because it is
// what makes Signal different from a feed; the feed sits under Evidence,
// where you go to check a claim rather than to browse.
export interface NavItem {
  href: string;
  label: string;
  hint: string;
  icon: IconName;
}

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Today",
    items: [
      { href: "/briefing", label: "Briefing", hint: "What moved overnight", icon: "briefing" },
      { href: "/alerts", label: "Alerts", hint: "Things that already happened", icon: "alerts" },
    ],
  },
  {
    label: "Forecast",
    items: [
      { href: "/forecast", label: "Predictions", hint: "What Signal expects next", icon: "predictions" },
      { href: "/scorecard", label: "Scorecard", hint: "How often it has been right", icon: "scorecard" },
    ],
  },
  {
    label: "Evidence",
    items: [
      { href: "/intel", label: "Signal feed", hint: "Everything collected", icon: "feed" },
      { href: "/board", label: "Competitors", hint: "Scores and trends", icon: "competitors" },
      { href: "/discovery", label: "Discovery", hint: "Candidates to confirm", icon: "discovery" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/chat", label: "Chat", hint: "Ask the evidence", icon: "chat" },
      { href: "/company", label: "Company", hint: "Your context", icon: "company" },
      { href: "/activity", label: "Agent activity", hint: "What the system is doing", icon: "activity" },
      { href: "/settings", label: "Settings", hint: "Budget, cadence, Slack", icon: "settings" },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
