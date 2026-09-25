"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

import { SignalMark } from "@/components/landing/SignalMark";

// Below `lg` the sidebar is hidden, so this bar has to carry navigation as
// well as identity — otherwise the app is unreachable on a phone. Above `lg`
// it steps back to a thin strip: the sidebar already says where you are, and
// repeating the page title here would just be chrome saying the same thing
// twice.
const NAV = [
  { href: "/briefing", label: "Briefing" },
  { href: "/forecast", label: "Predictions" },
  { href: "/scorecard", label: "Scorecard" },
  { href: "/intel", label: "Signal feed" },
  { href: "/board", label: "Competitors" },
  { href: "/discovery", label: "Discovery" },
  { href: "/alerts", label: "Alerts" },
  { href: "/chat", label: "Chat" },
  { href: "/company", label: "Company" },
  { href: "/activity", label: "Agent activity" },
  { href: "/settings", label: "Settings" },
];

export function TopBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-20 border-b border-line bg-surface/95 backdrop-blur lg:left-60">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line-strong text-ink"
          >
            <span className="sr-only">{open ? "Close navigation" : "Open navigation"}</span>
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              {open ? (
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M2 4h12M2 8h12M2 12h12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
          <Link href="/briefing" aria-label="Signal home">
            <SignalMark compact />
          </Link>
        </div>

        <div className="hidden flex-1 lg:block" />

        <div className="flex items-center gap-2">
          <kbd className="hidden rounded-sm border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-muted lg:block">
            ⌘K
          </kbd>
          <Link
            href="/settings"
            aria-label="Account settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line-strong text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                clipRule="evenodd"
              />
            </svg>
          </Link>
        </div>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Primary"
          className="border-t border-line bg-surface px-4 py-2 lg:hidden"
        >
          <ul className="grid grid-cols-2 gap-1">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "block rounded-md bg-ink px-3 py-2 text-[13px] font-medium text-ink-inverse"
                        : "block rounded-md px-3 py-2 text-[13px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                    }
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
