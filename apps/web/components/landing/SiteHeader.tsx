"use client";

import Link from "next/link";
import { useState } from "react";

import { SignalMark } from "./SignalMark";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#sources", label: "Sources" },
  { href: "#scorecard", label: "Scorecard" },
  { href: "#questions", label: "FAQ" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-ground/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" aria-label="Signal home" className="shrink-0">
          <SignalMark />
        </Link>

        <nav aria-label="Sections" className="hidden items-center gap-0.5 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-[14px] text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <Link
            href="/login"
            className="hidden rounded-lg px-3 py-2 text-[14px] font-medium text-ink transition-colors hover:bg-surface-sunken sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center rounded-lg bg-flare px-4 py-2 text-[14px] font-semibold text-midnight shadow-[0_8px_20px_-10px_rgba(249,110,49,0.8)] transition-colors hover:bg-flare-hover"
          >
            Start tracking
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="site-menu"
            className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink md:hidden"
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d={open ? "M4 4l8 8M12 4l-8 8" : "M2 4h12M2 8h12M2 12h12"}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {open ? (
        <nav id="site-menu" aria-label="Menu" className="border-t border-line bg-surface px-5 py-3 md:hidden">
          <ul className="grid gap-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-[15px] text-ink hover:bg-surface-sunken"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li className="mt-1 border-t border-line pt-2">
              <Link href="/login" className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-ink hover:bg-surface-sunken">
                Sign in to your workspace
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
