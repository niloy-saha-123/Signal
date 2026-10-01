"use client";

// A compact "last 30 days" coverage strip showing which days have collected signals.
// Presence-only (not counts) — derived from the already-fetched signal list, so it's
// honest about the data it has rather than inventing an aggregate the API doesn't expose.
export function DataCoverage({ dates }: { dates: string[] }) {
  const days: { label: string; active: boolean }[] = [];
  const active = new Set(dates.map((d) => d.slice(0, 10)));

  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({
      label: d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2),
      active: active.has(key),
    });
  }

  const activeCount = days.filter((d) => d.active).length;

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-ink">Days with new evidence</h2>
        {activeCount === 0 ? (
          <span className="text-[12.5px] text-ink-muted">None in the last 30 days</span>
        ) : (
          <span className="text-[12.5px] text-ink-muted">
            {activeCount} of the last 30
          </span>
        )}
      </div>
      <div className="flex gap-1" role="img" aria-label={`Evidence collected on ${activeCount} of the last 30 days`}>
        {days.map((day, index) => (
          <div key={index} className="flex flex-1 flex-col items-center gap-1.5">
            <div
              className={`h-8 w-full rounded-[4px] ${day.active ? "bg-ink" : "bg-surface-sunken"}`}
              title={day.active ? "Has signals" : "No signals"}
            />
            <span className="text-[10px] text-ink-muted" aria-hidden="true">{index % 5 === 0 ? day.label : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}