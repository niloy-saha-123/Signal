// Company / compare — advisory "them vs. us" output. The comparative-synthesis agent
// persists its result as alerts against the workspace's own-company competitor row, so
// this page reads those alerts and presents them as read-only recommendations.
import type { ReactNode } from "react";
import { CompanyAreaTabs } from "@/components/area-tabs";
import { AskButton } from "@/components/AskButton";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui/primitives";
import { listCompetitors, listAlerts } from "@/lib/api";
import { formatDate, patternLabel } from "@/lib/format";
import { getOptionalAccessToken } from "@/lib/supabase-server";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div>
      <PageHeader
        title="Us vs. them"
        description="Moves competitors made that you haven't, with Signal's read on why and what you could do. Advisory only; Signal never acts on these."
        action={<CompanyAreaTabs active="compare" />}
      />
      {children}
    </div>
  );
}

export default async function ComparePage() {
  const token = await getOptionalAccessToken();
  if (!token) {
    return (
      <Shell>
        <EmptyState
          title="Sign in to compare"
          note="The comparison is built from your own company profile and the competitors you watch."
          action={
            <LinkButton href="/login" variant="primary" size="sm">
              Sign in
            </LinkButton>
          }
        />
      </Shell>
    );
  }

  const competitors = await listCompetitors(token);
  const own = competitors.find((competitor) => competitor.is_own_company);

  if (!own) {
    return (
      <Shell>
        <EmptyState
          title="No comparison yet"
          note="Signal builds your side of the comparison after its weekly analysis. Filling in your company profile makes it sharper."
          action={
            <LinkButton href="/company" size="sm">
              Edit your profile
            </LinkButton>
          }
        />
      </Shell>
    );
  }

  const alerts = (await listAlerts({ competitor_ids: [own.id], limit: 50 }, token)).data;

  return (
    <Shell>
      {alerts.length === 0 ? (
        <EmptyState
          title="No comparison yet"
          note="The first one appears after the next weekly analysis."
        />
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => {
            const observations = (alert.evidence ?? []) as Array<{ competitor_name?: string; what_they_did?: string }>;
            const actions = ((alert.recommended_actions ?? []) as Array<{ action?: string }>).filter((a) => a.action);
            const title = patternLabel(alert.pattern);
            return (
              <li key={alert.id} className="rounded-[14px] border border-line bg-surface p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
                  <span className="text-[12.5px] text-ink-muted">{formatDate(alert.created_at)}</span>
                </div>
                <p className="mt-2 text-[14.5px] leading-relaxed break-words whitespace-pre-line text-ink-secondary">
                  {alert.interpretation}
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {observations.length > 0 && (
                    <div className="rounded-[10px] bg-sky p-4">
                      <h3 className="text-[13px] font-semibold text-ink-secondary">They moved</h3>
                      <ul className="mt-2 space-y-1.5">
                        {observations.map((observation, index) => (
                          <li key={index} className="text-[14px] text-ink">
                            <span className="font-semibold">{observation.competitor_name ?? "A competitor"}</span>:{" "}
                            {observation.what_they_did ?? ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {actions.length > 0 && (
                    <div className="rounded-[10px] bg-sky p-4">
                      <h3 className="text-[13px] font-semibold text-ink-secondary">You could</h3>
                      <ul className="mt-2 space-y-1.5">
                        {actions.map((action, index) => (
                          <li key={index} className="text-[14px] text-ink">
                            {action.action}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <AskButton prompt={`"${title}": should we respond, and how?`} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
