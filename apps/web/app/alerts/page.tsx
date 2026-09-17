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
    <div className="flex flex-col gap-8">
      <h1 className="font-serif text-4xl font-semibold text-slate-900">Alerts</h1>
      {alerts.length === 0 ? (
        <div className="flex items-center justify-center rounded-2xl bg-white p-12 shadow-sm">
          <p className="font-sans text-sm text-slate-400">No alerts yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {alerts.map((alert) => (
            <div key={alert.id} className="rounded-2xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="font-sans text-sm font-extrabold text-slate-900">
                    {names.get(alert.competitor_id) ?? "Unknown competitor"}
                  </p>
                  <p className="mt-2 font-sans text-base font-semibold capitalize leading-snug text-slate-900">
                    {alert.pattern.replace(/_/g, " ")}
                  </p>
                  <p className="mt-2 font-sans text-sm leading-relaxed text-slate-600">
                    {alert.interpretation}
                  </p>
                  <p className="mt-3 font-sans text-xs text-slate-400">
                    {new Date(alert.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-slate-100 px-3 py-1 font-sans text-xs font-bold text-slate-600">
                  {Math.round(alert.confidence * 100)}% confidence
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
