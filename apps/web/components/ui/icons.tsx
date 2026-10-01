// One stroke-icon set (20px grid, 1.7 stroke, round caps) so every icon in the
// app shares weight and corner style. Icons are decorative: the label beside
// them carries the meaning, so they render aria-hidden.
import type { ReactNode } from "react";

const PATHS = {
  home: <path d="M3.5 9 10 3.8 16.5 9v7.2a.8.8 0 0 1-.8.8h-3.4v-4.6H7.7V17H4.3a.8.8 0 0 1-.8-.8V9Z" />,
  forecast: (
    <>
      <circle cx="7.5" cy="7.5" r="3" />
      <path d="M7.5 1.8v1.3M2.3 7.5H1M3.8 3.8l.9.9M11.2 3.8l-.9.9" />
      <path d="M8 16.8h7.2a3 3 0 0 0 .2-6 4 4 0 0 0-7.6 1.2A2.4 2.4 0 0 0 8 16.8Z" />
    </>
  ),
  competitors: (
    <>
      <circle cx="7" cy="7" r="2.6" />
      <circle cx="14" cy="8.2" r="2.1" />
      <path d="M2.5 16.5c.5-2.6 2.3-4 4.5-4s4 1.4 4.5 4M11.6 13c.7-.6 1.5-.9 2.4-.9 1.8 0 3.1 1.1 3.5 3.4" />
    </>
  ),
  evidence: (
    <>
      <path d="M4 3.5h8.5L16 7v9.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-12.5a.5.5 0 0 1 .5-.5Z" />
      <path d="M12 3.5V7h4M7 10.5h6M7 13.5h4" />
    </>
  ),
  chat: <path d="M4 4.5h12a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9l-3.6 2.7v-2.7H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" />,
  company: (
    <>
      <path d="M3.5 17V5.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V17M11.5 8.5h4a1 1 0 0 1 1 1V17M2 17h16" />
      <path d="M6.5 7.5h2M6.5 10.5h2M6.5 13.5h2M13.5 11.5h1M13.5 14h1" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7" />
    </>
  ),
  activity: <path d="M2.5 10.5h3l2-5 3.5 9 2-5h4.5" />,
  alerts: (
    <>
      <path d="M5 14.5V9a5 5 0 0 1 10 0v5.5l1.3 1.5H3.7L5 14.5Z" />
      <path d="M8.3 17.5a1.8 1.8 0 0 0 3.4 0" />
    </>
  ),
  scorecard: (
    <>
      <path d="M3.5 16.5h13" />
      <path d="M5.5 16.5v-5M9 16.5V7M12.5 16.5v-7M16 16.5V4" />
    </>
  ),
  discovery: (
    <>
      <circle cx="8.8" cy="8.8" r="5" />
      <path d="m12.6 12.6 4 4M8.8 6.5v4.6M6.5 8.8h4.6" />
    </>
  ),
  search: (
    <>
      <circle cx="8.8" cy="8.8" r="5" />
      <path d="m12.6 12.6 4 4" />
    </>
  ),
  plus: <path d="M10 4v12M4 10h12" />,
  close: <path d="m5 5 10 10M15 5 5 15" />,
  menu: <path d="M3 5.5h14M3 10h14M3 14.5h14" />,
  arrowRight: <path d="M4 10h11.5M11 5.5l4.5 4.5-4.5 4.5" />,
  arrowLeft: <path d="M16 10H4.5M9 5.5 4.5 10 9 14.5" />,
  external: <path d="M8 4.5H5a1 1 0 0 0-1 1V15a1 1 0 0 0 1 1h9.5a1 1 0 0 0 1-1v-3M11 4h5v5M16 4l-7.5 7.5" />,
  check: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  send: <path d="M3.5 10 16.5 4l-4 12.5-3-5.2-6-1.3ZM9.5 11.3 16.5 4" />,
  refresh: <path d="M15.8 7.5A6.3 6.3 0 0 0 4.2 8M4.2 12.5a6.3 6.3 0 0 0 11.6.5M15.8 3.5v4h-4M4.2 16.5v-4h4" />,
  trash: <path d="M4 6h12M8 6V4.3h4V6M5.5 6l.8 10.2a.8.8 0 0 0 .8.8h5.8a.8.8 0 0 0 .8-.8L14.5 6" />,
  logout: <path d="M8 4H4.8a.8.8 0 0 0-.8.8v10.4a.8.8 0 0 0 .8.8H8M12 6.5 15.5 10 12 13.5M15.5 10H7.5" />,
  link: <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.8-2.8a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0l-2.8 2.8a3 3 0 0 0 4.2 4.2l.8-.8" />,
  slack: (
    <>
      <path d="M7.5 3.5v6M12.5 10.5v6M3.5 12.5h6M10.5 7.5h6" />
    </>
  ),
  upload: <path d="M10 13V3.5M6 7.5l4-4 4 4M3.5 13.5v2a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-2" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
