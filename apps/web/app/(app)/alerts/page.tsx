import { listAlerts, listCompetitors } from "@/lib/api";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { PREVIEW_ALERTS, PREVIEW_COMPETITORS } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";

export default async function Page() {
  const token = await getOptionalAccessToken();
  let competitors = PREVIEW_COMPETITORS;
  let alerts = PREVIEW_ALERTS;

  if (token) {
    try {
      competitors = await listCompetitors(token);
      const competitorIds = competitors.map((competitor) => competitor.id);
      alerts =
        competitorIds.length > 0
          ? (await listAlerts({ competitor_ids: competitorIds, limit: 100 }, token)).data
          : [];
    } catch {
      competitors = PREVIEW_COMPETITORS;
      alerts = PREVIEW_ALERTS;
    }
  }

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
          <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
            Alerts
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-studio-muted">
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
        <div className="flex items-center justify-center rounded-[1.6rem] border border-studio-line bg-studio-paper px-8 py-16">
          <p className="text-sm text-studio-muted">No alerts yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="rounded-[1.6rem] border border-studio-line bg-studio-paper p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm font-extrabold text-studio-ink">
                    {names.get(alert.competitor_id) ?? "Unknown competitor"}
                  </p>
                  <p className="mt-2 text-base leading-snug font-semibold text-studio-ink capitalize">
                    {alert.pattern.replace(/_/g, " ")}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-studio-muted">
                    {alert.interpretation}
                  </p>
                  <p className="mt-3 text-xs text-studio-muted">
                    {new Date(alert.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-studio-sky-soft px-3 py-1 text-xs font-bold text-studio-ink">
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
