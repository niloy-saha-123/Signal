"use client";

import { useRef, useState } from "react";

const SECTION_LINKS = [
  ["#product", "Product"],
  ["#workflow", "How it works"],
  ["#research", "Research chat"],
  ["#questions", "Questions"],
  ["/briefing", "Workspace"],
] as const;

export function MobileSectionNav() {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  function closeNavigation() {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
    setIsOpen(false);
  }

  return (
    <details
      ref={detailsRef}
      className="group relative ml-auto xl:hidden"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary
        aria-label={`${isOpen ? "Close" : "Open"} section navigation`}
        className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full border border-studio-line text-studio-ink transition-colors hover:bg-studio-sky-soft [&::-webkit-details-marker]:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
          <path
            d="M5 7.5h14M5 12h14M5 16.5h14"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </summary>
      <nav
        aria-label="Mobile section navigation"
        className="absolute top-13 right-0 z-50 w-52 overflow-hidden rounded-[10px] border border-studio-line bg-studio-paper p-2 shadow-[0_18px_42px_-24px_rgba(10,32,51,0.45)]"
      >
        {SECTION_LINKS.map(([href, label]) => (
          <a
            key={href}
            href={href}
            onClick={closeNavigation}
            className="block rounded-[10px] px-4 py-3 text-sm font-semibold text-studio-muted transition-colors hover:bg-studio-sky-soft hover:text-studio-ink"
          >
            {label}
          </a>
        ))}
      </nav>
    </details>
  );
}
