// The product itself, framed as a window, sitting on the hero.
//
// Every company in here is fictional. An illustrative prediction about a real
// business — "X will raise prices", "Signal called it and was right" — is an
// invented claim about that business, labelled or not, and this page does not
// make them. The window chrome also carries an explicit "Example workspace"
// label so no figure in it can be mistaken for measured performance.

const OPEN = [
  {
    company: "Kestrel",
    pattern: "Product launch",
    statement: "Ships a managed Postgres adapter within the quarter",
    probability: 72,
    resolves: "Dec 24",
    evidence: 9,
  },
  {
    company: "Halcyon",
    pattern: "Pricing change",
    statement: "Introduces usage-based pricing on the team plan",
    probability: 58,
    resolves: "Jan 12",
    evidence: 6,
  },
];

function Bar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-accent" style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-[12px] font-medium tabular-nums text-ink">{value}%</span>
    </div>
  );
}

export function ProductWindow() {
  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_30px_80px_-30px_rgba(11,59,56,0.35),0_0_0_1px_rgba(255,255,255,0.6)_inset]">
      {/* Window chrome. */}
      <div className="flex items-center gap-3 border-b border-line bg-surface-sunken px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#e8a39a]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ecc98a]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#9ccf9f]" />
        </div>
        <div className="mx-auto flex min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-3 py-1 text-[11px] text-ink-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          <span className="truncate font-mono">signal / forecast</span>
        </div>
        <span className="hidden shrink-0 rounded-sm border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-muted sm:inline">
          Example workspace
        </span>
      </div>

      <div className="grid md:grid-cols-[150px_minmax(0,1fr)]">
        {/* Sidebar. */}
        <div className="hidden border-r border-line bg-surface p-3 md:block" aria-hidden="true">
          {[
            ["Briefing", false],
            ["Predictions", true],
            ["Scorecard", false],
            ["Signal feed", false],
            ["Competitors", false],
            ["Agent activity", false],
          ].map(([label, active]) => (
            <div
              key={label as string}
              className={
                active
                  ? "mb-0.5 rounded-md bg-accent-tint px-2 py-1.5 text-[11px] font-semibold text-accent"
                  : "mb-0.5 rounded-md px-2 py-1.5 text-[11px] text-ink-secondary"
              }
            >
              {label}
            </div>
          ))}
        </div>

        <div className="min-w-0 bg-ground p-4 sm:p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold tracking-[-0.015em] text-ink">Predictions</span>
            <span className="text-[11px] text-ink-muted">ordered by what resolves soonest</span>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
            <div className="bg-[var(--color-tint-teal)] p-3">
              <div className="font-mono text-[20px] font-medium tabular-nums text-ink">2</div>
              <div className="text-[10px] font-medium text-ink-muted">Open</div>
            </div>
            <div className="bg-[var(--color-tint-sky)] p-3">
              <div className="font-mono text-[20px] font-medium text-ink-muted">—</div>
              <div className="text-[10px] font-medium text-ink-muted">Brier score</div>
            </div>
            <div className="bg-[var(--color-tint-sand)] p-3">
              <div className="font-mono text-[20px] font-medium tabular-nums text-ink-muted">0.25</div>
              <div className="text-[10px] font-medium text-ink-muted">Coin-flip baseline</div>
            </div>
          </div>

          <ul className="space-y-2">
            {OPEN.map((row) => (
              <li key={row.company} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-ink">{row.company}</span>
                      <span className="rounded-sm border border-line bg-surface-sunken px-1 py-px text-[10px] text-ink-secondary">
                        {row.pattern}
                      </span>
                    </div>
                    <p className="text-[13px] leading-snug text-ink">{row.statement}</p>
                  </div>
                  <Bar value={row.probability} />
                </div>
                <div className="mt-2.5 flex gap-4 border-t border-line pt-2 text-[10px] text-ink-muted">
                  <span>
                    Resolves <span className="font-mono text-ink-secondary">{row.resolves}</span>
                  </span>
                  <span>
                    Based on <span className="font-mono text-ink-secondary">{row.evidence}</span>{" "}
                    signals
                  </span>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-[11px] text-ink-muted">
            No score shown until predictions resolve — the dash is the honest reading.
          </p>
        </div>
      </div>
    </div>
  );
}
