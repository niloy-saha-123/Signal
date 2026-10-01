import { sourceColor } from "@/lib/chart-colors";

// Independent pieces of public evidence converge on one forecast. On wide
// screens the nodes orbit the card with connecting lines; below `lg` they stack
// above it, because a diagram squeezed to 375px is decoration, not information.

const NODES = [
  { source: "github", label: "GitHub", text: "PR merged: “pg driver behind a flag”", pos: "lg:left-0 lg:top-4" },
  { source: "jobs", label: "Jobs", text: "Two database engineer roles in two weeks", pos: "lg:right-0 lg:top-0" },
  { source: "website", label: "Website", text: "/product now says “bring your own database”", pos: "lg:left-[-8px] lg:top-[196px]" },
  { source: "docs", label: "Docs", text: "New page appeared: /docs/adapters/postgres", pos: "lg:right-[-8px] lg:top-[190px]" },
  { source: "changelog", label: "Changelog", text: "Connection pooling shipped as a prerequisite", pos: "lg:left-6 lg:bottom-2" },
  { source: "community", label: "Community", text: "Staff answered the Postgres support thread", pos: "lg:right-6 lg:bottom-0" },
] as const;

const LINES = [
  "M215 60 C 250 120, 230 170, 330 205",
  "M725 55 C 690 120, 720 165, 610 195",
  "M215 235 C 260 238, 290 240, 330 240",
  "M725 232 C 690 236, 650 240, 610 240",
  "M240 410 C 270 350, 250 300, 330 275",
  "M700 415 C 680 350, 700 300, 610 280",
];

export function EvidenceGraph() {
  return (
    <div className="relative mx-auto max-w-[940px]">
      <svg
        aria-hidden="true"
        viewBox="0 0 940 460"
        className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
        fill="none"
        strokeWidth="1.6"
      >
        {LINES.map((d, i) => (
          <path key={d} d={d} stroke={sourceColor(NODES[i]!.source)} />
        ))}
      </svg>

      <div className="grid gap-3 sm:grid-cols-2 lg:block lg:h-[460px]">
        {NODES.map((node) => (
          <div
            key={node.source}
            className={`rounded-[14px] border border-line bg-surface px-4 py-3 text-[14px] lg:absolute lg:w-[220px] ${node.pos}`}
          >
            <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-ink-secondary">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sourceColor(node.source) }} aria-hidden="true" />
              {node.label}
            </span>
            <p className="mt-1 leading-snug text-ink">{node.text}</p>
          </div>
        ))}

        <div className="mt-3 rounded-[20px] bg-ink p-6 text-white shadow-[var(--shadow-window)] sm:col-span-2 lg:absolute lg:top-1/2 lg:left-1/2 lg:mt-0 lg:w-[280px] lg:-translate-x-1/2 lg:-translate-y-1/2">
          <p className="text-[13px] font-semibold text-[#c9d6e3]">Kestrel · forecast</p>
          <p className="metric mt-2 text-[68px]" style={{ color: "var(--color-sun)" }}>
            72%
          </p>
          <p className="mt-2 text-[16px] leading-snug font-semibold">Ships a managed Postgres adapter by Dec 15</p>
          <p className="mt-3 text-[13px] text-[#c9d6e3]">6 independent sources · settles automatically on the date</p>
        </div>
      </div>
    </div>
  );
}
