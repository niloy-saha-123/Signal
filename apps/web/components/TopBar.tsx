"use client";
import { usePathname } from "next/navigation";

export function TopBar() {
  const pathname = usePathname();

  const getPageTitle = () => {
    if (pathname === "/briefing") return "Briefing";
    if (pathname === "/intel") return "Intel";
    if (pathname === "/discovery") return "Discovery";
    if (pathname === "/alerts") return "Alerts";
    if (pathname === "/board") return "Board";
    if (pathname === "/settings") return "Settings";
    if (pathname.startsWith("/radar")) return "Radar";
    if (pathname.startsWith("/company")) return "Company";
    return "";
  };

  return (
    <header className="fixed top-0 right-12 left-64 z-10 flex h-16 items-center justify-between border-b border-studio-line bg-studio-paper px-8 transition-all duration-300">
      <div className="flex-1">
        <h2 className="text-sm font-semibold text-studio-muted">{getPageTitle()}</h2>
      </div>

      <div className="flex items-center gap-3">
        <kbd className="hidden rounded-full border border-studio-line bg-studio-sky-soft px-2 py-1 text-xs text-studio-muted lg:block">
          ⌘K
        </kbd>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full bg-studio-ink text-sm font-extrabold text-white transition-all hover:bg-[#071625] active:scale-95"
          aria-label="User profile"
        >
          <span className="sr-only">Profile</span>
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
