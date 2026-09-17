import Link from "next/link";

import { SignalMark } from "@/components/landing/SignalMark";

const productLinks = [
  { href: "#product", label: "Product" },
  { href: "#workflow", label: "How it works" },
  { href: "#research", label: "Research chat" },
  { href: "#questions", label: "Questions" },
] as const;

const workspaceLinks = [
  { href: "/briefing", label: "Briefing" },
  { href: "/intel", label: "Intel" },
  { href: "/discovery", label: "Discovery" },
  { href: "/alerts", label: "Alerts" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-studio-line bg-studio-paper">
      <div className="mx-auto grid max-w-[86rem] gap-12 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_repeat(3,minmax(0,0.7fr))] lg:px-12">
        <div className="max-w-sm">
          <SignalMark />
          <p className="mt-5 text-sm leading-relaxed text-studio-muted">
            Signal watches the sources where competitors change first, groups related
            evidence, and puts a cited briefing on the desk in the morning.
          </p>
        </div>
        <nav aria-label="Product">
          <p className="text-sm font-bold text-studio-ink">Product</p>
          <ul className="mt-4 space-y-3">
            {productLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="text-sm font-semibold text-studio-muted hover:text-studio-ink">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Workspace">
          <p className="text-sm font-bold text-studio-ink">Workspace</p>
          <ul className="mt-4 space-y-3">
            {workspaceLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-sm font-semibold text-studio-muted hover:text-studio-ink">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Account">
          <p className="text-sm font-bold text-studio-ink">Account</p>
          <ul className="mt-4 space-y-3">
            <li>
              <Link href="/login" className="text-sm font-semibold text-studio-muted hover:text-studio-ink">
                Sign in
              </Link>
            </li>
            <li>
              <Link href="/signup" className="text-sm font-semibold text-studio-muted hover:text-studio-ink">
                Create a workspace
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-studio-line">
        <div className="mx-auto flex max-w-[86rem] flex-col gap-2 px-5 py-6 text-xs text-studio-muted sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <p>© 2026 Signal. Competitive intelligence with the sources still attached.</p>
          <p>Illustrative workspace views use example competitor movements.</p>
        </div>
      </div>
    </footer>
  );
}
