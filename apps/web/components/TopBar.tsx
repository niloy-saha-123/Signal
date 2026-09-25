"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

import { SignalMark } from "@/components/landing/SignalMark";
import { Icon } from "@/components/ui/icons";
import { NAV_ITEMS, isActive } from "@/lib/nav";

// The command palette listens for ⌘K on window; the search pill fires the
// same shortcut so there is exactly one code path that opens it.
function openCommandBar() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
}

// Below `lg` the sidebar is hidden, so this bar carries navigation as well as
// identity. Above `lg` it is a thin strip with search and the account.
export function TopBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = NAV_ITEMS.find((item) => isActive(pathname, item.href));

  return (
    <header className="fixed inset-x-0 top-0 z-20 border-b border-line bg-ground/85 backdrop-blur-md lg:left-60">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink"
          >
            <span className="sr-only">{open ? "Close navigation" : "Open navigation"}</span>
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              {open ? (
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
          <Link href="/briefing" aria-label="Signal home">
            <SignalMark compact />
          </Link>
        </div>

        <p className="hidden text-[13px] text-ink-muted lg:block">
          Workspace <span className="px-1.5 text-line-strong">/</span>
          <span className="font-medium text-ink">{current?.label ?? "Signal"}</span>
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCommandBar}
            className="hidden items-center gap-2 rounded-lg border border-line bg-surface py-1.5 pr-1.5 pl-3 text-[13px] text-ink-muted shadow-[var(--shadow-card)] transition-colors hover:text-ink sm:flex"
          >
            <Icon name="search" className="h-3.5 w-3.5" />
            <span className="w-40 text-left">Search or jump to…</span>
            <kbd className="rounded-md border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">⌘K</kbd>
          </button>
          <Link
            href="/settings"
            aria-label="Account settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,#e8f1ff,#efeefd)] text-accent ring-1 ring-line transition-colors hover:ring-accent-line"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
          </Link>
        </div>
      </div>

      {open ? (
        <nav id="mobile-nav" aria-label="Primary" className="border-t border-line bg-surface px-4 py-3 lg:hidden">
          <ul className="grid grid-cols-2 gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "flex items-center gap-2 rounded-lg bg-midnight px-3 py-2 text-[13px] font-medium text-white"
                        : "flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                    }
                  >
                    <Icon name={item.icon} className="h-4 w-4" />
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
