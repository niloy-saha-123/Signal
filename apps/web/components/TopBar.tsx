"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Wordmark } from "@/components/brand/Wordmark";
import { openCommandBar } from "@/components/CommandBar";
import { Icon } from "@/components/ui/icons";
import { NAV_ITEMS, isActive } from "@/lib/nav";

// Below `lg` the sidebar is hidden, so this bar carries navigation. Above `lg`
// it is a thin strip with search and account — the sidebar already says where
// you are.
export function TopBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="fixed inset-x-0 top-0 z-20 border-b border-line bg-ground/90 backdrop-blur lg:left-[248px]">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-line-strong bg-surface text-ink"
          >
            <span className="sr-only">{open ? "Close navigation" : "Open navigation"}</span>
            <Icon name={open ? "close" : "menu"} className="h-5 w-5" />
          </button>
          <Link href="/briefing" aria-label="Signal home">
            <Wordmark size={24} />
          </Link>
        </div>

        <button
          type="button"
          onClick={openCommandBar}
          className="hidden h-10 w-full max-w-sm items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink lg:flex"
        >
          <Icon name="search" className="h-4 w-4" />
          <span className="flex-1 text-left">Search pages or ask Signal</span>
          <kbd className="rounded-[5px] border border-line px-1.5 text-[11px]">⌘K</kbd>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCommandBar}
            aria-label="Search"
            className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-line-strong bg-surface text-ink lg:hidden"
          >
            <Icon name="search" className="h-5 w-5" />
          </button>
          <Link
            href="/settings"
            aria-label="Account settings"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-secondary transition-colors hover:text-ink"
          >
            <svg className="h-[18px] w-[18px]" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
          </Link>
        </div>
      </div>

      {open ? (
        <nav id="mobile-nav" aria-label="Primary" className="border-t border-line bg-surface px-4 py-3 lg:hidden">
          <ul className="grid grid-cols-2 gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "flex items-center gap-2.5 rounded-[10px] bg-sky px-3 py-2.5 text-[14px] font-semibold text-ink"
                        : "flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[14px] text-ink-secondary hover:bg-surface-sunken"
                    }
                  >
                    <Icon name={item.icon} className="h-[18px] w-[18px]" />
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
