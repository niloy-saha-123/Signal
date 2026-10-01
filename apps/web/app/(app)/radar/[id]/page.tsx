// Competitor profile — the PM battlecard: activity score, open forecasts, recent
// evidence by source, which sources are live, trend and hiring. Secondary fetches
// degrade to designed empty panels; only the competitor itself is required.
//
// Without a session (dev preview) only the fictional preview competitors render,
// and never with forecasts.
import type { Signal } from "@signal/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ApiError,
  getCompetitor,
  getCompetitorHiring,
  getCompetitorScore,
  getCompetitorScoreHistory,
  getCompetitorTrend,
  listPredictions,
  listSignals,
  type Competitor,
  type CompetitorHiringDelta,
  type CompetitorTrendPoint,
  type PredictionRow,
} from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { previewCompetitorProfile } from "@/lib/preview-workspace";
import { SignalScoreCard } from "@/components/SignalScoreCard";
import { TrendChart } from "@/components/TrendChart";
import { HiringChart } from "@/components/HiringChart";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { AnalyzeButton } from "@/components/AnalyzeButton";
import { AskButton } from "@/components/AskButton";
import { DiscoveryStatus } from "@/components/DiscoveryStatus";
import { EvidenceBySource } from "@/components/competitors/EvidenceBySource";
import { ForecastCard } from "@/components/forecast/parts";
import { Icon } from "@/components/ui/icons";
import { EmptyState, PageHeader, StatusDot } from "@/components/ui/primitives";
import { sourceColor, sourceLabel } from "@/lib/chart-colors";

const EVIDENCE_DAYS = 30;

interface Profile {
  competitor: Competitor;
  score: { score: number; delta_7d: number | null } | null;
  history: Array<{ date: string; score: number }>;
  trend: CompetitorTrendPoint[];
  hiring: CompetitorHiringDelta[];
  forecasts: PredictionRow[];
  signals: Signal[];
}

async function loadProfile(id: string, token: string): Promise<Profile> {
  let competitor: Competitor;
  try {
    competitor = await getCompetitor(id, token);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 401)) notFound();
    throw error;
  }

  const since = new Date(Date.now() - EVIDENCE_DAYS * 86_400_000).toISOString();
  const [score, history, trend, hiring, forecasts, signals] = await Promise.all([
    getCompetitorScore(id, token).catch(() => null),
    getCompetitorScoreHistory(id, 90, token).catch(() => []),
    getCompetitorTrend(id, 30, token).catch(() => []),
    getCompetitorHiring(id, 30, token).catch(() => []),
    listPredictions({ competitor_id: id, status: "open", limit: 20 }, token).catch(() => []),
    listSignals({ competitor_ids: [id], created_after: since, limit: 50 }, token)
      .then((page) => page.data)
      .catch(() => []),
  ]);

  return {
    competitor,
    score,
    history: history.map((row) => ({ date: row.computed_at, score: row.score })),
    trend,
    hiring,
    forecasts: forecasts.sort((a, b) => new Date(a.resolves_at).getTime() - new Date(b.resolves_at).getTime()),
    signals,
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getOptionalAccessToken();

  let profile: Profile;
  if (token) {
    profile = await loadProfile(id, token);
  } else {
    const preview = previewCompetitorProfile(id);
    if (!preview) notFound();
    profile = { ...preview, history: [], trend: [], hiring: [], forecasts: [] };
  }

  const { competitor, score, history, trend, hiring, forecasts, signals } = profile;
  const discovering = competitor.discovery_status === "pending" || competitor.discovery_status === "in_progress";

  return (
    <div>
      <Link
        href="/board"
        className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-ink-secondary hover:text-ink"
      >
        <Icon name="arrowLeft" className="h-4 w-4" />
        Competitors
      </Link>

      <PageHeader
        title={competitor.name}
        description={
          <>
            <a
              href={`https://${competitor.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-accent hover:underline"
            >
              {competitor.domain}
            </a>
            {" · "}What they&apos;re doing, what Signal expects next, and the evidence behind it.
          </>
        }
        action={
          <>
            <AnalyzeButton competitorId={competitor.id} name={competitor.name} />
            <AskButton
              label="Ask about them"
              prompt={`What is ${competitor.name} likely to do next, and what's the evidence?`}
            />
            <ExportCsvButton
              rows={history.map((row) => ({ date: row.date, score: row.score }))}
              columns={[
                { key: "date", label: "Date" },
                { key: "score", label: "Activity score" },
              ]}
              filename={`${competitor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-activity.csv`}
              label="Export"
            />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title="Pulse">
          {score ? (
            <SignalScoreCard score={score.score} delta7d={score.delta_7d} history={history} />
          ) : (
            <EmptyState
              compact
              title="No activity score yet"
              note="The score appears once Signal has collected from a few of this competitor's sources."
            />
          )}
        </Panel>

        <Panel title="Open forecasts" count={forecasts.length}>
          {forecasts.length === 0 ? (
            <EmptyState
              compact
              title={`No open forecasts for ${competitor.name}`}
              note="Signal forecasts only when several independent signals agree. Until then it stays quiet."
            />
          ) : (
            <ul className="space-y-3">
              {forecasts.slice(0, 3).map((prediction) => (
                <ForecastCard key={prediction.id} prediction={prediction} competitor={competitor.name} />
              ))}
              {forecasts.length > 3 ? (
                <li>
                  <Link href="/forecast" className="text-[13.5px] font-semibold text-accent hover:underline">
                    {forecasts.length - 3} more open forecast{forecasts.length - 3 === 1 ? "" : "s"}
                  </Link>
                </li>
              ) : null}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Recent evidence" description={`Last ${EVIDENCE_DAYS} days`}>
          <EvidenceBySource signals={signals} />
        </Panel>

        <Panel title="Sources" description="What Signal watches for this competitor">
          <SourceCoverage competitor={competitor} signals={signals} />
          {discovering ? (
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 text-[13px] font-semibold text-ink">Still looking</p>
              <DiscoveryStatus competitorId={competitor.id} />
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Trend" description="Mentions, sentiment and activity, last 30 days">
          {trend.length > 0 ? (
            <TrendChart data={trend} />
          ) : (
            <EmptyState compact title="No trend yet" note="A trend needs a few days of collected signals." />
          )}
        </Panel>
        <Panel title="Hiring" description="Open roles by team, last 30 days vs the 30 before">
          {hiring.length > 0 ? (
            <HiringChart data={hiring} />
          ) : (
            <EmptyState
              compact
              title="No hiring changes in the last 30 days"
              note="Shows up when their job board adds or removes roles."
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description?: string;
  count?: number;
  children: ReactNode;
}) {
  const headingId = `panel-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-[14px] border border-line bg-surface p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-[15px] font-semibold text-ink">
          {title}
          {count !== undefined && count > 0 ? <span className="tnum ml-1.5 text-ink-muted">{count}</span> : null}
        </h2>
        {description ? <p className="text-right text-[12.5px] text-ink-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

type Coverage = "Reporting" | "Watching" | "Looking" | "Not found";

// "Reporting" = produced evidence in the window; "Watching" = configured but
// quiet; "Not found" = discovery found nothing to watch. Sources without a
// per-competitor setting appear only once they report.
function coverageFor(competitor: Competitor, signals: Signal[]): Array<{ source: string; state: Coverage }> {
  const reporting = new Set<string>(signals.map((signal) => signal.source));
  const configured: Record<string, boolean> = {
    website: Boolean(competitor.domain),
    pricing: Boolean(competitor.pricing_url),
    changelog: Boolean(competitor.changelog_rss),
    jobs: Boolean(competitor.greenhouse_token || competitor.lever_token),
    reddit: competitor.subreddits.length > 0,
    hn: true,
  };
  const sources = [...Object.keys(configured), ...[...reporting].filter((source) => !(source in configured))];
  return sources.map((source) => ({
    source,
    state: reporting.has(source)
      ? "Reporting"
      : configured[source]
        ? "Watching"
        : competitor.discovery_status === "complete" || competitor.discovery_status === "failed"
          ? "Not found"
          : "Looking",
  }));
}

function SourceCoverage({ competitor, signals }: { competitor: Competitor; signals: Signal[] }) {
  return (
    <ul className="space-y-2.5">
      {coverageFor(competitor, signals).map(({ source, state }) => (
        <li key={source} className="flex items-center justify-between gap-3 text-[14px]">
          <span className="flex items-center gap-2 font-medium text-ink">
            <StatusDot color={sourceColor(source)} />
            {sourceLabel(source)}
          </span>
          <span
            className={
              state === "Reporting"
                ? "text-[12.5px] font-semibold text-hit-text"
                : state === "Watching"
                  ? "text-[12.5px] text-ink-secondary"
                  : "text-[12.5px] text-ink-muted"
            }
          >
            {state}
          </span>
        </li>
      ))}
    </ul>
  );
}
