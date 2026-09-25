import Link from "next/link";

import { SignalMark } from "./SignalMark";

const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: "Product",
    links: [
      { href: "/#product", label: "Product tour" },
      { href: "/#how", label: "How it works" },
      { href: "/#sources", label: "Sources" },
      { href: "/#scorecard", label: "Scorecard" },
      { href: "/#questions", label: "FAQ" },
    ],
  },
  {
    title: "Workspace",
    links: [
      { href: "/briefing", label: "Briefing" },
      { href: "/forecast", label: "Predictions" },
      { href: "/scorecard", label: "Track record" },
      { href: "/intel", label: "Signal feed" },
      { href: "/activity", label: "Agent activity" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/signup", label: "Create a workspace" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs">
          <SignalMark />
          <p className="mt-4 text-[14px] leading-relaxed text-ink-secondary">
            Signal reads the public trail competitors leave, writes down what it expects them to do next, and scores
            itself when the date arrives.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="text-[13px] font-semibold text-ink">{column.title}</p>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-[14px] text-ink-secondary transition-colors hover:text-accent">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-5 py-6 text-[12.5px] text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© 2026 Signal · Probabilities, never certainties.</p>
          <p>Product views on this site use fictional companies and example data.</p>
        </div>
      </div>
    </footer>
  );
}
