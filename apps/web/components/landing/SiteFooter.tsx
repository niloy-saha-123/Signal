import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";

const PRODUCT = [
  { href: "/briefing", label: "Home" },
  { href: "/forecast", label: "Forecasts" },
  { href: "/board", label: "Competitors" },
  { href: "/chat", label: "Ask Signal" },
];

const ACCOUNT = [
  { href: "/signup", label: "Create a workspace" },
  { href: "/login", label: "Log in" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-5 py-10 sm:px-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Wordmark size={26} />
          <p className="mt-3 text-[14px] text-ink-secondary">
            Signal states probabilities, never certainties, and scores every one of them.
          </p>
        </div>
        <div className="flex gap-14">
          <nav aria-label="Product">
            <ul className="space-y-2 text-[14px]">
              {PRODUCT.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-ink-secondary hover:text-ink">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Account">
            <ul className="space-y-2 text-[14px]">
              {ACCOUNT.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-ink-secondary hover:text-ink">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
