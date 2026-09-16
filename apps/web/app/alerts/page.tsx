// apps/web/app/alerts/page.tsx
// Full alert history — single fetch, no pagination UI (simplification: add real pagination
// if usage ever needs more than 100).
import { listAlerts, listCompetitors } from "../../lib/api";
import { getServerAccessToken } from "../../lib/supabase-server";

export default async function Page() {
  const token = await getServerAccessToken();
  const competitors = await listCompetitors(token);
  const competitorIds = competitors.map((c) => c.id);
  const names = new Map(competitors.map((c) => [c.id, c.name]));

  const { data: alerts } =
    competitorIds.length > 0
      ? await listAlerts({ competitor_ids: competitorIds, limit: 100 }, token)
      : { data: [] };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Alerts</h1>
      {alerts.length === 0 ? (
        <p className="text-sm text-slate-500">No alerts yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {alerts.map((alert) => (
            <li key={alert.id} className="rounded-md border border-slate-200 bg-white p-3">
              <p className="text-sm font-medium text-slate-900">
                {names.get(alert.competitor_id) ?? "Unknown competitor"} — {alert.pattern}
              </p>
              <p className="mt-1 text-sm text-slate-600">{alert.interpretation}</p>
              <p className="mt-1 text-xs text-slate-400">
                {new Date(alert.created_at).toLocaleString()} · confidence{" "}
                {Math.round(alert.confidence * 100)}%
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
