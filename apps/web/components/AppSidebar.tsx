"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Wordmark } from "@/components/brand/Wordmark";
import { Icon } from "@/components/ui/icons";
import { openCommandBar } from "@/components/CommandBar";
import { PRIMARY_NAV, SECONDARY_NAV, isActive, type NavItem } from "@/lib/nav";

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={item.hint}
      className={
        active
          ? "relative flex h-10 items-center gap-3 rounded-[10px] bg-sky px-3 text-[14px] font-semibold text-ink before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-sun-deep"
          : "flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
      }
    >
      <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
      {item.label}
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-surface lg:flex"
    >
      <Link href="/briefing" className="flex h-16 items-center px-5" aria-label="Signal home">
        <Wordmark size={28} />
      </Link>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={openCommandBar}
          className="flex h-10 w-full items-center gap-2.5 rounded-[10px] border border-line-strong bg-surface px-3 text-left text-[14px] text-ink-muted transition-colors hover:border-ink hover:text-ink"
        >
          <Icon name="search" className="h-4 w-4" />
          <span className="flex-1">Search or ask</span>
          <kbd className="rounded-[5px] border border-line px-1.5 text-[11px] text-ink-muted">⌘K</kbd>
        </button>
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {PRIMARY_NAV.map((item) => (
          <li key={item.href}>
            <NavLink item={item} pathname={pathname} />
          </li>
        ))}
      </ul>

      <ul className="space-y-0.5 border-t border-line px-3 py-3">
        {SECONDARY_NAV.map((item) => (
          <li key={item.href}>
            <NavLink item={item} pathname={pathname} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
