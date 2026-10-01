// Alerts — moves that crossed the confidence bar, each with what to do about it.
// Preview data only without a session.
import Link from "next/link";
import { listAlerts, listCompetitors, type Alert, type Competitor } from "@/lib/api";
import { AskButton } from "@/components/AskButton";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { EvidenceAreaTabs } from "@/components/evidence/parts";
import { Badge, EmptyState, LinkButton, PageHeader } from "@/components/ui/primitives";
import { PREVIEW_ALERTS, PREVIEW_COMPETITORS } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { patternLabel, relativeTime } from "@/lib/format";

function firstAction(alert: Alert): string | null {
  const action = alert.recommended_actions[0]?.action;
  return typeof action === "string" ? action : null;
}

function renderAlerts(competitors: Competitor[], alerts: Alert[]) {
  const names = new Map(competitors.map((competitor) => [competitor.id, competitor.name]));

  const exportRows = alerts.map((alert) => ({
    competitor: names.get(alert.competitor_id) ?? "Unknown",
    pattern: patternLabel(alert.pattern),
    interpretation: alert.interpretation,
    confidence: Math.round(alert.confidence * 100),
    vulnerability_window_days: alert.vulnerability_window_days ?? "",
    created_at: alert.created_at,
  }));

  return (
    <div>
      <PageHeader
        title="Evidence"
        description="Alerts are moves that crossed the confidence bar. Each says what changed and what to do about it."
        action={<EvidenceAreaTabs active="alerts" />}
      />
      <div className="mb-5 flex justify-end">
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
        <EmptyState
          title="No alerts yet"
          note={
            competitors.length === 0
              ? "Alerts start once you're watching a competitor."
              : "Signal alerts only when several sources point the same way. Quiet is the normal state."
          }
          action={
            competitors.length === 0 ? (
              <LinkButton href="/board" variant="primary" size="sm">
                Add a competitor
              </LinkButton>
            ) : (
              <LinkButton href="/intel" size="sm">
                See the raw evidence
              </LinkButton>
            )
          }
        />
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => {
            const competitor = names.get(alert.competitor_id) ?? "Unknown competitor";
            const action = firstAction(alert);
            const move = patternLabel(alert.pattern);
            return (
              <li key={alert.id} className="rounded-[14px] border border-line bg-surface p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/radar/${alert.competitor_id}`} className="text-[13.5px] font-bold text-ink hover:underline">
                    {competitor}
                  </Link>
                  <Badge>{move}</Badge>
                  <span className="text-[12.5px] text-ink-muted" suppressHydrationWarning>
                    {relativeTime(alert.created_at)}
                  </span>
                  <span className="tnum ml-auto text-[13px] font-semibold text-ink">
                    {Math.round(alert.confidence * 100)}% confident
                  </span>
                </div>
                <p className="mt-2 text-[15px] leading-relaxed break-words text-ink">{alert.interpretation}</p>
                {action ? (
                  <div className="mt-3 rounded-[10px] bg-sky px-4 py-3">
                    <p className="text-[12.5px] font-semibold text-ink-secondary">What to do</p>
                    <p className="mt-0.5 text-[14px] text-ink">{action}</p>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <AskButton prompt={`${competitor}: "${move}". What's the evidence, and how should we respond?`} />
                  {alert.vulnerability_window_days ? (
                    <span className="text-[13px] text-ink-muted">
                      Window to respond: about {alert.vulnerability_window_days} days
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
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
    competitorIds.length > 0 ? (await listAlerts({ competitor_ids: competitorIds, limit: 100 }, token)).data : [];

  return renderAlerts(competitors, alerts);
}
