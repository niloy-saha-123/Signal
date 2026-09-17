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

  const first = days.findIndex((d) => d.active);
  const last = days.map((d) => d.active).lastIndexOf(true);

  return (
    <div className="flex flex-col gap-3 rounded-[1.6rem] border border-studio-line bg-studio-paper p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-studio-ink">Data coverage</h2>
        {first === -1 ? (
          <span className="text-xs text-studio-muted">No signals in the last 30 days</span>
        ) : (
          <span className="text-xs text-studio-muted">
            {days[first].label} — {days[last].label}
          </span>
        )}
      </div>
      <div className="flex gap-1">
        {days.map((day, index) => (
          <div key={index} className="flex flex-1 flex-col items-center gap-1.5">
            <div
              className={`h-10 w-full rounded-md ${
                day.active ? "bg-studio-action" : "bg-studio-sky"
              }`}
              title={day.active ? "Has signals" : "No signals"}
            />
            <span className="text-[10px] text-studio-muted">{index % 5 === 0 ? day.label : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}