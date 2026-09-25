"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignalMark } from "@/components/landing/SignalMark";
import { Icon } from "@/components/ui/icons";
import { NAV_GROUPS, isActive } from "@/lib/nav";

// Midnight rail, white canvas. The brand is present on every screen without
// tinting the work itself, and the active item is the only place the flare
// appears in the app chrome — a small marker that says "you are here".
export function AppSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-midnight text-midnight-ink lg:flex"
    >
      <Link href="/briefing" className="flex h-16 items-center px-5">
        <SignalMark tone="dark" />
      </Link>

      <div className="flex-1 overflow-y-auto px-3 pt-2 pb-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            <h2 className="px-2.5 pb-1.5 font-sans text-[11px] font-medium tracking-normal text-midnight-muted">
              {group.label}
            </h2>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={
                        active
                          ? "relative flex items-center gap-2.5 rounded-lg bg-white/[0.09] px-2.5 py-2 text-[13px] font-medium text-white before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-[3px] before:rounded-r before:bg-flare"
                          : "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-midnight-muted transition-colors hover:bg-white/[0.05] hover:text-white"
                      }
                    >
                      <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="m-3 rounded-xl border border-midnight-line bg-midnight-raised px-3.5 py-3">
        <p className="text-[12px] font-medium text-white">Probabilities, never certainties.</p>
        <p className="mt-1 text-[11px] leading-relaxed text-midnight-muted">
          Every forecast is dated and scored when it resolves.
        </p>
      </div>
    </nav>
  );
}
