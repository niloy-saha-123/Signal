// Agent activity — the page that makes autonomy checkable instead of claimed.
//
// Every competitor in this category asks you to trust that something is running
// in the background. This shows it: what ran, what it decided, what it cost,
// and which dependencies are currently broken.
import { getActivity, listCompetitors } from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Metric,
  Num,
  PageHeader,
} from "@/components/ui/primitives";

const TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

function durationLabel(started: string, completed: string | null): string {
  if (!completed) return "running";
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export default async function ActivityPage() {
  const token = await getOptionalAccessToken();

  const empty = {
    runs: [],
    spend_today_usd: 0,
    daily_budget_usd: 2,
    open_circuits: [] as string[],
  };

  const [activity, competitors] = token
    ? await Promise.all([
        getActivity(token).catch(() => empty),
        listCompetitors(token).catch(() => []),
      ])
    : [empty, []];

  const nameFor = (id: string) =>
    competitors.find((competitor) => competitor.id === id)?.name ?? "Unknown";

  const budgetUsed =
    activity.daily_budget_usd > 0
      ? Math.min(1, activity.spend_today_usd / activity.daily_budget_usd)
      : 0;

  return (
    <div>
      <PageHeader
        title="Agent activity"
        description="What Signal has been doing, what it spent doing it, and whether anything it depends on is currently down."
      />

      <div className="mb-6 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        <div className="bg-[var(--color-tint-blue)] p-5">
          <Metric value={String(activity.runs.length)} label="Recent runs" size="md" />
        </div>
        <div className="bg-[var(--color-tint-mist)] p-5">
          <Metric
            value={`$${activity.spend_today_usd.toFixed(2)}`}
            label="Model spend today"
            size="md"
          />
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
            <div
              className={
                budgetUsed > 0.85
                  ? "h-full rounded-full bg-[var(--color-status-critical)]"
                  : "h-full rounded-full bg-accent"
              }
              style={{ width: `${Math.max(2, budgetUsed * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-muted">
            of ${activity.daily_budget_usd.toFixed(2)} daily budget
          </p>
        </div>
        <div className="bg-[var(--color-tint-flare)] p-5">
          <Metric
            value={String(activity.open_circuits.length)}
            label="Open circuits"
            size="md"
            tone={activity.open_circuits.length > 0 ? "miss" : "default"}
          />
          <p className="mt-2 text-[12px] text-ink-muted">
            {activity.open_circuits.length === 0
              ? "Every dependency is responding."
              : `Paused: ${activity.open_circuits.join(", ")}`}
          </p>
        </div>
      </div>

      {activity.open_circuits.length > 0 ? (
        <div className="mb-6 rounded-lg border border-[#f3c0ca] bg-[#fdecef] px-5 py-4">
          <p className="text-[14px] font-medium text-[var(--color-status-critical)]">
            {activity.open_circuits.length} dependenc
            {activity.open_circuits.length === 1 ? "y is" : "ies are"} circuit-broken
          </p>
          <p className="mt-1 text-[13px] text-ink-secondary">
            Signal has stopped calling {activity.open_circuits.join(", ")} after repeated
            failures, and will retry automatically. Collection and analysis that depend on
            {activity.open_circuits.length === 1 ? " it" : " them"} are paused until it
            recovers — this is the system protecting itself, not a crash.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Runs"
          description="Every analysis, chat and discovery run for this workspace, newest first."
        />
        <CardBody>
          {activity.runs.length === 0 ? (
            <EmptyState
              title="Nothing has run yet"
              note="Collectors run on a schedule and analysis follows them. Add a competitor and the first runs appear within a few hours."
            />
          ) : (
            <ul>
              {activity.runs.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge
                      tone={
                        run.status === "completed"
                          ? "hit"
                          : run.status === "failed"
                            ? "miss"
                            : "open"
                      }
                    >
                      {run.status}
                    </Badge>
                    <span className="truncate text-[13px] text-ink">
                      {nameFor(run.competitor_id)}
                    </span>
                    <span className="text-[12px] text-ink-muted">{run.trigger}</span>
                    {run.outcome ? (
                      <span className="text-[12px] text-ink-muted">→ {run.outcome}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-4">
                    <Num className="text-ink-muted">
                      {durationLabel(run.started_at, run.completed_at)}
                    </Num>
                    <Num className="text-ink-muted">
                      {TIME.format(new Date(run.started_at))}
                    </Num>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
