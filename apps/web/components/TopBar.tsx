"use client";
import { usePathname } from "next/navigation";

export function TopBar() {
  const pathname = usePathname();
  
  // Get page title based on current route
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
    <header className="fixed left-64 right-96 top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8 transition-all duration-300">
      {/* Page indicator */}
      <div className="flex-1">
        <h2 className="font-sans text-sm font-semibold text-slate-400">{getPageTitle()}</h2>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-3">
        {/* Command bar trigger hint */}
        <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-2 py-1 font-sans text-xs text-slate-500 lg:block">
          ⌘K
        </kbd>
        
        {/* Profile button */}
        <button 
          className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 font-sans text-sm font-extrabold text-white transition-all hover:bg-indigo-700 active:scale-95"
          aria-label="User profile"
        >
          <span className="sr-only">Profile</span>
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </header>
  );
}
