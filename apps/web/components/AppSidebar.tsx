"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignalMark } from "@/components/landing/SignalMark";

// Navigation grouped by the question each surface answers, not by data model.
// "Forecast" and "Scorecard" lead because they are what makes this product
// different from a feed; the feed itself sits under Evidence, where a reader
// goes to check a claim rather than to browse.
const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ href: string; label: string; hint: string }>;
}> = [
  {
    label: "Today",
    items: [
      { href: "/briefing", label: "Briefing", hint: "What moved overnight" },
      { href: "/alerts", label: "Alerts", hint: "Things that already happened" },
    ],
  },
  {
    label: "Forecast",
    items: [
      { href: "/forecast", label: "Predictions", hint: "What Signal expects next" },
      { href: "/scorecard", label: "Scorecard", hint: "How often it has been right" },
    ],
  },
  {
    label: "Evidence",
    items: [
      { href: "/intel", label: "Signal feed", hint: "Everything collected" },
      { href: "/board", label: "Competitors", hint: "Scores and trends" },
      { href: "/discovery", label: "Discovery", hint: "Candidates to confirm" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/chat", label: "Chat", hint: "Ask the evidence" },
      { href: "/company", label: "Company", hint: "Your context" },
      { href: "/activity", label: "Agent activity", hint: "What the system is doing" },
      { href: "/settings", label: "Settings", hint: "Budget, cadence, Slack" },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface lg:flex"
    >
      <Link
        href="/briefing"
        className="flex items-center gap-2.5 border-b border-line px-5 py-4 text-ink"
      >
        <SignalMark />
      </Link>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            <h2 className="px-2 pb-1.5 text-[11px] font-semibold text-ink-muted">{group.label}</h2>
            <ul>
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      // Active is solid ink, not a tinted accent pill — the
                      // accent marks what is interactive, ink marks what is
                      // currently chosen.
                      className={
                        active
                          ? "block rounded-md bg-ink px-2 py-1.5 text-[13px] font-medium text-ink-inverse"
                          : "block rounded-md px-2 py-1.5 text-[13px] text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
                      }
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line px-5 py-3">
        <p className="text-[11px] text-ink-muted">
          Signal states probabilities, never certainties.
        </p>
      </div>
    </nav>
  );
}
