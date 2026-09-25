// The product explained as one picture: public evidence arriving over weeks,
// a forecast issued once enough independent evidence lines up, the launch,
// and the resolution. Fictional company, illustrative dates.

type Kind = "evidence" | "forecast" | "launch" | "resolved";

const EVENTS: Array<{ week: number; kind: Kind; source?: string; label: string; detail: string }> = [
  { week: 1, kind: "evidence", source: "github", label: "Pull request", detail: "feat: pg driver behind a flag" },
  { week: 2.2, kind: "evidence", source: "jobs", label: "Hiring", detail: "Two database-engineer roles posted" },
  { week: 3.3, kind: "evidence", source: "community", label: "Forum", detail: "Staff answer a thread on Postgres support" },
  { week: 4.4, kind: "evidence", source: "website", label: "Website", detail: "/product now says “bring your own database”" },
  { week: 5, kind: "forecast", label: "Forecast", detail: "Managed Postgres adapter · 72%" },
  { week: 6.4, kind: "evidence", source: "changelog", label: "Changelog", detail: "Connection pooling ships" },
  { week: 8.5, kind: "launch", label: "Launch post", detail: "“Introducing managed Postgres”" },
  { week: 9.4, kind: "resolved", label: "Resolved", detail: "Hit · Brier-scored" },
];

const SOURCE_COLOR: Record<string, string> = {
  github: "var(--color-source-github)",
  jobs: "var(--color-source-jobs)",
  community: "var(--color-source-community)",
  website: "var(--color-source-website)",
  changelog: "var(--color-source-changelog)",
};

function dotColor(kind: Kind, source?: string) {
  if (kind === "forecast") return "var(--color-flare)";
  if (kind === "launch") return "var(--color-midnight)";
  if (kind === "resolved") return "var(--color-outcome-hit)";
  return source ? SOURCE_COLOR[source] : "var(--color-ink-muted)";
}

const WEEKS = 10;

export function LeadTimeline() {
  return (
    <div className="rounded-[22px] bg-surface p-5 shadow-[var(--shadow-card)] sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[14px] font-semibold text-ink">Kestrel · managed Postgres</p>
        <p className="text-[12px] text-ink-muted">Illustrative timeline · fictional company</p>
      </div>

      {/* Desktop: a real timeline. */}
      <div className="relative mt-10 hidden h-[260px] md:block">
        {/* Lead-time bracket: first evidence to the launch post. */}
        <div
          className="absolute top-0 h-8 rounded-t-lg border-x border-t border-dashed border-accent-line"
          style={{ left: `${(1 / WEEKS) * 100}%`, width: `${((8.5 - 1) / WEEKS) * 100}%` }}
        >
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-tint px-2.5 py-0.5 text-[11.5px] font-medium text-accent">
            Lead time — read before the announcement
          </span>
        </div>

        <div className="absolute inset-x-0 top-[128px] h-px bg-line-strong" />
        <div
          className="absolute top-[127px] h-[3px] rounded-full bg-[linear-gradient(90deg,var(--color-trace-c),var(--color-accent),var(--color-flare))]"
          style={{ left: `${(1 / WEEKS) * 100}%`, width: `${((5 - 1) / WEEKS) * 100}%` }}
        />

        {EVENTS.map((event, index) => {
          const above = index % 2 === 0;
          const special = event.kind !== "evidence";
          return (
            <div
              key={event.label + event.week}
              className="absolute top-[128px] -translate-x-1/2"
              style={{ left: `${(event.week / WEEKS) * 100}%` }}
            >
              <span
                className={`absolute left-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-surface ${
                  special ? "h-4 w-4" : "h-3 w-3"
                }`}
                style={{ backgroundColor: dotColor(event.kind, event.source) }}
              />
              <span
                className={`absolute left-1/2 w-px -translate-x-1/2 bg-line-strong ${above ? "bottom-2 h-7" : "top-2 h-7"}`}
              />
              <div
                className={`absolute left-1/2 w-[150px] -translate-x-1/2 text-center ${above ? "bottom-10" : "top-10"}`}
              >
                <p
                  className={`text-[11px] font-semibold ${
                    event.kind === "forecast" ? "text-flare-deep" : "text-ink-muted"
                  }`}
                >
                  {event.label}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink">{event.detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile: the same events as a vertical list. */}
      <ol className="mt-6 space-y-4 border-l border-line-strong pl-5 md:hidden">
        {EVENTS.map((event) => (
          <li key={event.label + event.week} className="relative">
            <span
              className="absolute top-1.5 -left-[26px] h-3 w-3 rounded-full ring-4 ring-surface"
              style={{ backgroundColor: dotColor(event.kind, event.source) }}
            />
            <p className={`text-[11px] font-semibold ${event.kind === "forecast" ? "text-flare-deep" : "text-ink-muted"}`}>
              {event.label}
            </p>
            <p className="text-[14px] text-ink">{event.detail}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
