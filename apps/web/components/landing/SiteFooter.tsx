import Link from "next/link";

import { SignalMark } from "@/components/landing/SignalMark";

const productLinks = [
  { href: "/#how", label: "How it works" },
  { href: "/#capabilities", label: "Capabilities" },
  { href: "/#sources", label: "Sources" },
  { href: "/#questions", label: "Questions" },
] as const;

const workspaceLinks = [
  { href: "/briefing", label: "Briefing" },
  { href: "/forecast", label: "Predictions" },
  { href: "/scorecard", label: "Scorecard" },
  { href: "/intel", label: "Signal feed" },
  { href: "/activity", label: "Agent activity" },
] as const;

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 pt-16 pb-10 sm:px-8 md:grid-cols-[1.5fr_repeat(3,minmax(0,0.7fr))]">
        <div className="max-w-sm">
          <SignalMark />
          <p className="mt-5 text-[14px] leading-relaxed text-ink-secondary">
            Signal reads the public trail competitors leave, writes down what it expects them
            to do next, and scores itself when the date arrives.
          </p>
        </div>
        <nav aria-label="Product">
          <p className="text-[13px] font-semibold text-ink">Product</p>
          <ul className="mt-4 space-y-2.5">
            {productLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="text-[13px] text-ink-secondary transition-colors hover:text-accent">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Workspace">
          <p className="text-[13px] font-semibold text-ink">Workspace</p>
          <ul className="mt-4 space-y-2.5">
            {workspaceLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-[13px] text-ink-secondary transition-colors hover:text-accent">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Account">
          <p className="text-[13px] font-semibold text-ink">Account</p>
          <ul className="mt-4 space-y-2.5">
            <li>
              <Link href="/login" className="text-[13px] text-ink-secondary transition-colors hover:text-accent">
                Sign in
              </Link>
            </li>
            <li>
              <Link href="/signup" className="text-[13px] text-ink-secondary transition-colors hover:text-accent">
                Create a workspace
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-col gap-2 border-t border-line py-6 text-[12px] text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; 2026 Signal. Probabilities, never certainties.</p>
          <p>Product views on this page use fictional companies and example data.</p>
        </div>
      </div>

      {/* Oversized wordmark bleeding off the bottom edge. Decorative only —
          the accessible name is carried by the logo above. */}
      <div
        aria-hidden="true"
        className="pointer-events-none mx-auto -mb-[0.22em] max-w-6xl px-5 text-[clamp(5rem,22vw,17rem)] leading-none font-semibold tracking-[-0.05em] text-[var(--color-accent-line)] opacity-40 select-none sm:px-8"
      >
        Signal
      </div>
    </footer>
  );
}
