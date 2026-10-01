// How Signal keeps itself honest, shown as a short ledger. Every row is
// illustrative and labelled so; nothing here is a measured track record.

const ENTRIES = [
  { claim: "Kestrel ships CLI v2 by Sep 30", said: 68, outcome: "Hit", note: "Released Sep 22" },
  { claim: "Northwind raises Team pricing by Oct 15", said: 55, outcome: "Miss", note: "Pricing unchanged" },
  { claim: "Lumen opens an EU region by Oct 1", said: 40, outcome: "Unresolved", note: "No evidence either way" },
] as const;

const OUTCOME_STYLE = {
  Hit: "bg-tint-mint text-outcome-hit",
  Miss: "bg-tint-rose text-outcome-miss",
  Unresolved: "bg-surface-sunken text-ink-secondary",
} as const;

export function ScoreLedger() {
  return (
    <div className="rounded-[20px] border border-line bg-surface p-2">
      <ul className="divide-y divide-line">
        {ENTRIES.map((entry) => (
          <li key={entry.claim} className="flex items-center gap-4 px-4 py-4">
            <span className="metric w-[60px] shrink-0 text-[26px]">{entry.said}%</span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink">{entry.claim}</p>
              <p className="text-[13px] text-ink-muted">{entry.note}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-bold ${OUTCOME_STYLE[entry.outcome]}`}>
              {entry.outcome}
            </span>
          </li>
        ))}
      </ul>
      <div className="mx-2 mb-2 rounded-[14px] bg-sky px-4 py-3.5 text-[14px] text-ink-secondary">
        <span className="font-semibold text-ink">Scored with a Brier score</span>, next to the 0.25 you&rsquo;d get by
        answering &ldquo;maybe&rdquo; to everything. Unresolved windows are left out rather than counted as misses.
        <span className="mt-1 block text-[12.5px] text-ink-muted">Illustrative entries with fictional companies.</span>
      </div>
    </div>
  );
}
