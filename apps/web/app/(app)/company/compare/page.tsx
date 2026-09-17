// Company / compare — advisory "them vs. us" output. The comparative-synthesis agent
// persists its result as alerts against the workspace's own-company competitor row, so
// this page reads those alerts and presents them as read-only recommendations.
import Link from "next/link";
import { listCompetitors, listAlerts } from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";

export default async function ComparePage() {
  const token = await getOptionalAccessToken();
  if (!token) {
    return (
      <div className="rounded-[1.6rem] border border-studio-line bg-studio-paper px-6 py-12">
        <p className="text-sm text-studio-muted">Sign in to see how you compare to competitors.</p>
      </div>
    );
  }

  const competitors = await listCompetitors(token).catch(() => []);
  const own = competitors.find((competitor) => competitor.is_own_company);

  if (!own) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
            Us vs. them
          </h1>
          <p className="text-sm text-studio-muted">
            How your company&apos;s posture compares to the competitors you track.
          </p>
        </div>
        <div className="rounded-[1.6rem] border border-studio-line bg-studio-paper px-6 py-12">
          <p className="max-w-md text-sm leading-relaxed text-studio-muted">
            Signal hasn&apos;t built your company&apos;s own profile yet. It runs after your weekly analysis
            sweep — check back once tracking is active.
          </p>
        </div>
      </div>
    );
  }

  const alerts = (await listAlerts({ competitor_ids: [own.id], limit: 50 }, token).catch(() => ({ data: [] }))).data;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
          Us vs. them
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-studio-muted">
          Competitors did these things, you haven&apos;t — with Signal&apos;s read on why and what you
          might do. Advisory only; Signal never acts on these.
        </p>
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-[1.6rem] border border-studio-line bg-studio-paper px-6 py-12">
          <p className="text-sm text-studio-muted">No comparison generated yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {alerts.map((alert) => {
            const observations = (alert.evidence ?? []) as Array<{
              competitor_name?: string;
              what_they_did?: string;
            }>;
            const actions = (alert.recommended_actions ?? []) as Array<{ action?: string }>;
            return (
              <div
                key={alert.id}
                className="rounded-[1.6rem] border border-studio-line bg-studio-paper p-6"
              >
                <h2 className="text-lg font-extrabold text-studio-ink">{alert.pattern}</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-studio-muted">
                  {alert.interpretation}
                </p>

                {observations.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-studio-muted">
                      They moved
                    </p>
                    <ul className="mt-2 flex flex-col gap-2">
                      {observations.map((observation, index) => (
                        <li key={index} className="text-sm text-studio-ink">
                          <span className="font-semibold">{observation.competitor_name ?? "A competitor"}</span>
                          {" — "}
                          {observation.what_they_did ?? ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {actions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-studio-muted">
                      You could
                    </p>
                    <ul className="mt-2 flex flex-col gap-2">
                      {actions.map((action, index) => (
                        <li key={index} className="text-sm text-studio-ink">
                          {action.action ?? ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="mt-4 text-xs text-studio-muted">
                  {new Date(alert.created_at).toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <Link
        href="/company"
        className="self-start text-sm font-semibold text-studio-action hover:underline"
      >
        ← Back to company
      </Link>
    </div>
  );
}