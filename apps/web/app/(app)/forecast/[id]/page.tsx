// One forecast, with the evidence it was made from. The evidence is the body of
// the page rather than a drawer: a forecast you cannot audit is an assertion
// with a percentage attached.
import Link from "next/link";
import { notFound } from "next/navigation";
import { AskButton } from "@/components/AskButton";
import { RoadmapLinks } from "@/components/forecast/RoadmapLinks";
import { OutcomeBadge } from "@/components/forecast/parts";
import { Icon } from "@/components/ui/icons";
import { Badge, Card, CardBody, CardHeader, Probability, SourceChip } from "@/components/ui/primitives";
import { ApiError, getPrediction, type ResolutionCriteria } from "@/lib/api";
import { sourceLabel } from "@/lib/chart-colors";
import { daysUntil, formatDate, patternLabel } from "@/lib/format";
import { getOptionalAccessToken } from "@/lib/supabase-server";

// Typed as the real union so TypeScript narrows on `kind`; the exhaustive check
// fails to compile if a variant is ever added.
function criteriaSummary(criteria: ResolutionCriteria): string {
  switch (criteria.kind) {
    case "signal_match":
      return `It counts as a hit if collected evidence mentions all of: ${criteria.all_of.join(", ")} — searching ${criteria.sources.map(sourceLabel).join(", ")}.`;
    case "github_release":
      return `It counts as a hit if ${criteria.repo} publishes a release mentioning ${criteria.mentions.join(" or ")}.`;
    case "pricing_change":
      return criteria.direction === "any"
        ? "It counts as a hit if any pricing change is recorded in the window."
        : `It counts as a hit if a pricing ${criteria.direction} is recorded in the window.`;
    default: {
      const exhaustive: never = criteria;
      void exhaustive;
      return "These settlement rules aren't recognised by this version of the app.";
    }
  }
}

export default async function PredictionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getOptionalAccessToken();
  if (!token) notFound();

  const prediction = await getPrediction(id, token).catch((error) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });
  if (!prediction) notFound();

  const open = prediction.status === "open";
  const days = daysUntil(prediction.resolves_at);
  const bySource = Object.entries(
    prediction.evidence.reduce<Record<string, number>>((acc, signal) => {
      acc[signal.source] = (acc[signal.source] ?? 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="max-w-4xl">
      <Link href="/forecast" className="mb-6 inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink-secondary hover:text-ink">
        <Icon name="arrowLeft" className="h-4 w-4" />
        Forecasts
      </Link>

      <div className="rounded-[20px] bg-sky p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{patternLabel(prediction.pattern_type)}</Badge>
          <OutcomeBadge status={prediction.status} />
        </div>
        <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="max-w-2xl font-display text-[30px] leading-[1.1] font-semibold tracking-[-0.03em] text-ink sm:text-[36px]">
            {prediction.statement}
          </h1>
          <div className="shrink-0 sm:text-right">
            <Probability value={prediction.probability} size="lg" />
            <p className="mt-1 text-[13px] text-ink-muted">{open ? "likely" : "what Signal said"}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px] text-ink-secondary">
          <span suppressHydrationWarning>
            {open ? (days > 0 ? `${days} day${days === 1 ? "" : "s"} left · ` : "Due now · ") : ""}
            {open ? "settles" : "settled"} <span className="font-semibold text-ink">{formatDate(open ? prediction.resolves_at : prediction.resolved_at ?? prediction.resolves_at)}</span>
          </span>
          <span>
            <span className="font-semibold text-ink">{prediction.evidence_count}</span> signals behind it
          </span>
          {prediction.brier_score !== null ? (
            <span>
              Brier <span className="tnum font-semibold text-ink">{prediction.brier_score.toFixed(3)}</span>
            </span>
          ) : null}
          <span className="ml-auto">
            <AskButton prompt={`Walk me through the evidence for: "${prediction.statement}". What would change your mind?`} />
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-6">
        {open ? (
          <Card>
            <CardHeader title="How this settles" />
            <CardBody>
              <p className="text-[15px] text-ink">{criteriaSummary(prediction.resolution_criteria)}</p>
              <p className="mt-2 text-[14px] text-ink-secondary">
                Checked automatically on the date by matching collected evidence. No model decides the outcome.
              </p>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader title="What actually happened" />
            <CardBody>
              <p className="text-[15px] text-ink">{prediction.resolution_note}</p>
              {prediction.resolution_evidence_urls.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {prediction.resolution_evidence_urls.map((url) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-[14px] text-accent hover:underline">
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {prediction.status === "unresolved" ? (
                <p className="mt-3 text-[14px] text-ink-muted">
                  No score was recorded. A window that closed with no evidence either way says nothing about whether
                  the forecast was good, so it is left out of the scorecard rather than counted as a miss.
                </p>
              ) : null}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Roadmap"
            description={
              prediction.status === "open"
                ? "The roadmap items this forecast affects."
                : "What the team decided before this forecast settled. Locked."
            }
          />
          <CardBody>
            <RoadmapLinks
              predictionId={prediction.id}
              initialLinks={prediction.roadmap_links}
              readOnly={prediction.status !== "open"}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Evidence"
            description="The signals this forecast was made from, as they were at the time."
            action={
              bySource.length ? (
                <div className="hidden flex-wrap justify-end gap-1.5 sm:flex">
                  {bySource.map(([source, count]) => (
                    <span key={source} className="inline-flex items-center gap-1">
                      <SourceChip source={source} />
                      <span className="tnum text-[12px] text-ink-muted">×{count}</span>
                    </span>
                  ))}
                </div>
              ) : null
            }
          />
          <CardBody>
            {prediction.evidence.length === 0 ? (
              <p className="text-[14px] text-ink-muted">The underlying signals are no longer available.</p>
            ) : (
              <ul className="divide-y divide-line">
                {prediction.evidence.map((signal) => (
                  <li key={signal.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SourceChip source={signal.source} />
                      <span className="text-[12.5px] text-ink-muted">{formatDate(signal.collected_at)}</span>
                    </div>
                    <p className="mt-2 text-[15px] font-semibold text-ink">
                      {signal.source_url ? (
                        <a href={signal.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {signal.title ?? "(untitled)"}
                        </a>
                      ) : (
                        (signal.title ?? "(untitled)")
                      )}
                    </p>
                    <p className="mt-1 line-clamp-3 text-[14px] text-ink-secondary">{signal.raw_text}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
