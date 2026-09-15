import Link from "next/link";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/intel", label: "Intel" },
  { href: "/chat", label: "Chat" },
  { href: "/alerts", label: "Alerts" },
  { href: "/settings", label: "Settings" },
] as const;

export function SiteNav() {
  return (
    <nav className="flex items-center gap-6 border-b border-slate-200 bg-white px-8 py-4">
      <span className="text-lg font-semibold text-indigo-600">Signal</span>
      <div className="flex gap-4 text-sm font-medium text-slate-600">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md px-3 py-1.5 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
