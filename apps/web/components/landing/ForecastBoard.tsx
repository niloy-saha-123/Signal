// The product's main board, as it looks with a few competitors in it. Outlook
// chips use tinted fills with ink text (never white on a saturated fill), and
// the floating toast shows the board changing as evidence lands.

type Outlook = "Likely" | "Building" | "Watching" | "Unlikely";

const OUTLOOK_STYLE: Record<Outlook, string> = {
  Likely: "bg-tint-mint text-[#0a6b43]",
  Building: "bg-tint-sky text-[#174fa3]",
  Watching: "bg-tint-sun text-[#7a5a00]",
  Unlikely: "bg-surface-sunken text-ink-secondary",
};

const ROWS: Array<{ name: string; initial: string; color: string; move: string; when: string; outlook: Outlook; odds: number }> = [
  { name: "Kestrel", initial: "K", color: "#d63c55", move: "Managed Postgres adapter", when: "Dec 15", outlook: "Likely", odds: 72 },
  { name: "Lumen", initial: "L", color: "#4a3aa7", move: "Agents SDK in public beta", when: "Nov 20", outlook: "Building", odds: 64 },
  { name: "Northwind", initial: "N", color: "#1f6fd1", move: "Usage-based pricing tier", when: "Jan 30", outlook: "Watching", odds: 41 },
  { name: "Arclight", initial: "A", color: "#0a8a55", move: "Drops the free tier", when: "Mar 31", outlook: "Unlikely", odds: 18 },
];

export function ForecastBoard() {
  return (
    <div className="relative min-w-0">
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-window)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <p className="font-display text-[19px] font-semibold text-ink">Competitor forecast</p>
          <div className="flex gap-1 rounded-[10px] bg-surface-sunken p-1 text-[13px] font-semibold">
            <span className="rounded-[8px] bg-surface px-2.5 py-1 text-ink shadow-[0_1px_2px_rgba(15,29,43,0.12)]">Board</span>
            <span className="px-2.5 py-1 text-ink-secondary">Timeline</span>
            <span className="px-2.5 py-1 text-ink-secondary">Scorecard</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[14px]">
            <thead>
              <tr className="text-[12.5px] text-ink-muted">
                <th scope="col" className="px-5 py-2.5 font-semibold">Competitor</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Next likely move</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">By</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Outlook</th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">Odds</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.name} className="border-t border-line">
                  <td className="px-5 py-3.5">
                    <span className="flex items-center gap-2.5 font-semibold text-ink">
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[12px] font-bold text-white"
                        style={{ backgroundColor: row.color }}
                        aria-hidden="true"
                      >
                        {row.initial}
                      </span>
                      {row.name}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-ink">{row.move}</td>
                  <td className="tnum px-3 py-3.5 text-ink-secondary">{row.when}</td>
                  <td className="px-3 py-3.5">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[12.5px] font-bold ${OUTLOOK_STYLE[row.outlook]}`}>
                      {row.outlook}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="metric text-[24px]">{row.odds}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div
        className="window-in mt-4 flex max-w-[330px] items-start gap-3 rounded-[14px] bg-surface px-4 py-3 text-[14px] shadow-[var(--shadow-popover)] lg:absolute lg:right-[-18px] lg:bottom-[-72px] lg:mt-0"
        style={{ animationDelay: "300ms" }}
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-sun font-display font-extrabold text-ink" aria-hidden="true">
          ↑
        </span>
        <p className="text-ink-secondary">
          <span className="font-semibold text-ink">Odds moved on Kestrel.</span> Two database roles posted. Postgres
          adapter <span className="tnum font-bold text-ink">63% → 72%</span>
        </p>
      </div>
    </div>
  );
}
