import { listAlerts, listCompetitors } from "@/lib/api";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { PREVIEW_ALERTS, PREVIEW_COMPETITORS } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";

function renderAlerts(competitors: typeof PREVIEW_COMPETITORS, alerts: typeof PREVIEW_ALERTS) {
  const names = new Map(competitors.map((competitor) => [competitor.id, competitor.name]));

  const exportRows = alerts.map((alert) => ({
    competitor: names.get(alert.competitor_id) ?? "Unknown",
    pattern: alert.pattern.replace(/_/g, " "),
    interpretation: alert.interpretation,
    confidence: Math.round(alert.confidence * 100),
    vulnerability_window_days: alert.vulnerability_window_days ?? "",
    created_at: alert.created_at,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className=" text-4xl font-semibold tracking-[-0.035em] text-ink">
            Alerts
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-ink-secondary">
            Movements that crossed the confidence bar. Each one still points at the evidence
            that produced it.
          </p>
        </div>
        <ExportCsvButton
          rows={exportRows}
          columns={[
            { key: "competitor", label: "Competitor" },
            { key: "pattern", label: "Pattern" },
            { key: "interpretation", label: "Interpretation" },
            { key: "confidence", label: "Confidence %" },
            { key: "vulnerability_window_days", label: "Window (days)" },
            { key: "created_at", label: "Detected at" },
          ]}
          filename="signal-alerts.csv"
        />
      </div>
      {alerts.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl bg-surface shadow-[var(--shadow-card)] px-8 py-16">
          <p className="text-sm text-ink-secondary">No alerts yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="rounded-xl bg-surface shadow-[var(--shadow-card)] p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm font-extrabold text-ink">
                    {names.get(alert.competitor_id) ?? "Unknown competitor"}
                  </p>
                  <p className="mt-2 text-base leading-snug font-semibold text-ink capitalize">
                    {alert.pattern.replace(/_/g, " ")}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
                    {alert.interpretation}
                  </p>
                  <p className="mt-3 text-xs text-ink-secondary">
                    {new Date(alert.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-surface-sunken px-3 py-1 text-xs font-semibold text-ink">
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

export default async function Page() {
  const token = await getOptionalAccessToken();

  if (!token) {
    return renderAlerts(PREVIEW_COMPETITORS, PREVIEW_ALERTS);
  }

  const competitors = await listCompetitors(token);
  const competitorIds = competitors.map((competitor) => competitor.id);
  const alerts =
    competitorIds.length > 0
      ? (await listAlerts({ competitor_ids: competitorIds, limit: 100 }, token)).data
      : [];

  return renderAlerts(competitors, alerts);
}