import { Icon, type IconName } from "@/components/ui/icons";

// The hero image is the product itself: a forecast view for a fictional
// workspace. Every company and figure here is invented and the frame says so.

const NAV: Array<{ icon: IconName; label: string; active?: boolean }> = [
  { icon: "briefing", label: "Briefing" },
  { icon: "predictions", label: "Predictions", active: true },
  { icon: "scorecard", label: "Scorecard" },
  { icon: "feed", label: "Signal feed" },
  { icon: "chat", label: "Chat" },
];

const PREDICTIONS = [
  {
    company: "Kestrel",
    claim: "Ships a managed Postgres adapter",
    p: 72,
    resolves: "Dec 15",
    clusters: 6,
    sources: ["github", "jobs", "website", "community"],
    selected: true,
  },
  {
    company: "Halcyon",
    claim: "Moves usage pricing onto the team plan",
    p: 58,
    resolves: "Nov 30",
    clusters: 5,
    sources: ["pricing", "changelog", "postings"],
  },
  {
    company: "Parallax",
    claim: "Opens an EU data region",
    p: 41,
    resolves: "Jan 20",
    clusters: 5,
    sources: ["jobs", "community", "hn"],
  },
];

const SOURCE_DOT: Record<string, string> = {
  github: "var(--color-source-github)",
  jobs: "var(--color-source-jobs)",
  website: "var(--color-source-website)",
  community: "var(--color-source-community)",
  pricing: "var(--color-source-pricing)",
  changelog: "var(--color-source-changelog)",
  postings: "var(--color-source-postings)",
  hn: "var(--color-source-hn)",
};

// Evidence density for the selected prediction, week by week. Shape only.
const DENSITY = [4, 5, 5, 7, 6, 9, 11, 10, 14, 17, 19, 24, 26, 31];

function EvidenceChart() {
  const w = 420;
  const h = 150;
  const max = 34;
  const step = w / (DENSITY.length - 1);
  const pts = DENSITY.map((v, i) => [i * step, h - (v / max) * h] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const [fx, fy] = pts[9];

  return (
    <svg viewBox={`0 0 ${w} ${h + 22}`} className="h-auto w-full" aria-hidden="true">
      <defs>
        <linearGradient id="hero-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1="0" x2={w} y1={h * t} y2={h * t} stroke="var(--color-line)" strokeDasharray="3 4" />
      ))}
      <path d={area} fill="url(#hero-area)" />
      <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2.2" strokeLinejoin="round" />
      <line x1={fx} x2={fx} y1="0" y2={h} stroke="var(--color-flare)" strokeDasharray="3 3" />
      <circle cx={fx} cy={fy} r="9" fill="var(--color-flare)" opacity="0.2" />
      <circle cx={fx} cy={fy} r="4.5" fill="var(--color-flare)" />
      <line x1={w - 1} x2={w - 1} y1="0" y2={h} stroke="var(--color-ink)" strokeOpacity="0.5" />
      <text x={fx - 8} y="14" fontSize="10.5" textAnchor="end" fill="var(--color-flare-deep)" fontFamily="var(--font-mono)">
        forecast issued
      </text>
      <text x={w - 6} y="14" fontSize="10.5" textAnchor="end" fill="var(--color-ink-secondary)" fontFamily="var(--font-mono)">
        resolves
      </text>
      <text x="0" y={h + 16} fontSize="10" fill="var(--color-ink-muted)" fontFamily="var(--font-mono)">
        evidence clusters over 14 weeks
      </text>
    </svg>
  );
}

export function HeroProduct() {
  return (
    <div className="rounded-[22px] bg-white/55 p-2 shadow-[var(--shadow-float)] ring-1 ring-line backdrop-blur-sm">
      <div className="overflow-hidden rounded-[16px] bg-surface ring-1 ring-line">
        {/* Window chrome */}
        <div className="flex items-center gap-3 border-b border-line bg-surface-sunken/70 px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          </div>
          <span className="mx-auto rounded-md bg-surface px-3 py-0.5 font-mono text-[11px] text-ink-muted ring-1 ring-line">
            app.signal / forecast
          </span>
          <span className="hidden rounded-md bg-tint-flare px-2 py-0.5 text-[11px] font-medium text-flare-deep sm:inline">
            Illustrative
          </span>
        </div>

        <div className="grid md:grid-cols-[176px_1fr]">
          {/* Mini sidebar — same midnight rail as the app */}
          <div className="hidden flex-col gap-0.5 bg-midnight p-3 md:flex">
            <div className="mb-3 flex items-center gap-2 px-1.5 pt-1">
              <span className="h-5 w-5 rounded-md bg-[linear-gradient(135deg,#2b61cc,#061436)] ring-1 ring-white/10" />
              <span className="text-[12px] font-semibold text-white">Signal</span>
            </div>
            {NAV.map((item) => (
              <div
                key={item.label}
                className={`relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] ${
                  item.active
                    ? "bg-white/10 font-medium text-white before:absolute before:inset-y-1.5 before:-left-3 before:w-[3px] before:rounded-r before:bg-flare"
                    : "text-midnight-muted"
                }`}
              >
                <Icon name={item.icon} className="h-3.5 w-3.5" />
                {item.label}
              </div>
            ))}
          </div>

          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-display text-[17px] font-semibold text-ink">Predictions</p>
              <div className="flex gap-1 text-[11.5px]">
                <span className="rounded-md bg-accent px-2 py-1 font-medium text-white">Open 3</span>
                <span className="rounded-md px-2 py-1 text-ink-secondary">Resolved</span>
                <span className="rounded-md px-2 py-1 text-ink-secondary">All</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl ring-1 ring-line sm:grid-cols-4">
              {[
                ["3", "Open", "bg-tint-blue"],
                ["1", "Due this month", "bg-tint-mist"],
                ["—", "Brier score", "bg-tint-lilac"],
                ["0.25", "Coin-flip baseline", "bg-tint-flare"],
              ].map(([value, label, tint]) => (
                <div key={label} className={`${tint} border-line px-3 py-2.5 [&:not(:last-child)]:border-r`}>
                  <div className="font-mono text-[19px] font-medium text-ink tabular">{value}</div>
                  <div className="mt-0.5 text-[11px] text-ink-muted">{label}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.05fr_1fr]">
              <ul className="space-y-2">
                {PREDICTIONS.map((row) => (
                  <li
                    key={row.company}
                    className={`rounded-xl px-3 py-2.5 ring-1 ${
                      row.selected ? "bg-tint-blue/60 ring-accent-line" : "bg-surface ring-line"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12.5px] font-semibold text-ink">{row.company}</span>
                      <span className="font-mono text-[12.5px] font-medium text-ink tabular">{row.p}%</span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink-secondary">{row.claim}</p>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-trace-b),var(--color-accent))]"
                        style={{ width: `${row.p}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10.5px] text-ink-muted">
                      <span className="flex items-center gap-1">
                        {row.sources.map((source) => (
                          <span
                            key={source}
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: SOURCE_DOT[source] }}
                          />
                        ))}
                        <span className="ml-1 font-mono">{row.clusters} clusters</span>
                      </span>
                      <span className="font-mono">resolves {row.resolves}</span>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="rounded-xl p-3.5 ring-1 ring-line">
                <div className="flex items-center justify-between">
                  <p className="text-[12.5px] font-semibold text-ink">Kestrel · evidence</p>
                  <span className="rounded-md bg-accent-tint px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                    Open
                  </span>
                </div>
                <div className="mt-3">
                  <EvidenceChart />
                </div>
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">
                  Resolves by a GitHub release matching <span className="font-mono text-ink">/postgres/i</span> before
                  the date. No evidence either way is recorded as unresolved, not a miss.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
