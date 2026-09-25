import Link from "next/link";

const NAV_LINKS = [
  { href: "/briefing", label: "Briefing" },
  { href: "/intel", label: "Intel" },
  { href: "/discovery", label: "Discovery" },
  { href: "/chat", label: "Chat" },
  { href: "/alerts", label: "Alerts" },
  { href: "/settings", label: "Settings" },
] as const;

export function SiteNav() {
  return (
    <nav className="flex items-center gap-6 border-b border-slate-200 bg-white px-8 py-4">
      <Link href="/briefing" className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-slate-900">
          <span className="font-sans text-sm font-extrabold text-white">S</span>
        </div>
        <span className="font-sans text-lg font-extrabold text-slate-900">signal</span>
      </Link>
      <div className="flex gap-1 font-sans text-sm font-semibold text-slate-600">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-[10px] px-3 py-1.5 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
