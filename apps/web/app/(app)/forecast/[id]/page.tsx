// One prediction, with the evidence it was made from.
//
// The evidence list is the reason a prediction is worth anything, so it is the
// body of the page rather than a drawer. A forecast you cannot audit is just an
// assertion with a percentage attached.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrediction } from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { Badge, Card, CardBody, CardHeader, Metric, Num } from "@/components/ui/primitives";
import type { ResolutionCriteria } from "@/lib/api";
import { SOURCE_COLORS } from "@/lib/chart-colors";

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const PATTERN_LABEL: Record<string, string> = {
  product_launch: "Product launch",
  pricing_change: "Pricing change",
  upmarket_pivot: "Upmarket pivot",
  platform_expansion: "Platform expansion",
  hiring_surge: "Hiring surge",
  deprecation: "Deprecation",
};

// Typed as the real union so TypeScript narrows on `kind` and the exhaustive
// check below fails to compile if a variant is ever added. Casting this to
// Record<string, unknown> and re-deriving field shapes with `as string[]` threw
// away exactly the safety the shared schema exists to provide.
function criteriaSummary(criteria: ResolutionCriteria): string {
  switch (criteria.kind) {
    case "signal_match":
      return `Resolves as a hit if every one of these appears in collected signal: ${criteria.all_of.join(", ")} — searching ${criteria.sources.join(", ")}.`;
    case "github_release":
      return `Resolves as a hit if ${criteria.repo} publishes a release mentioning ${criteria.mentions.join(" or ")}.`;
    case "pricing_change":
      return criteria.direction === "any"
        ? "Resolves as a hit if any pricing change is recorded in the window."
        : `Resolves as a hit if a pricing ${criteria.direction} is recorded in the window.`;
    default: {
      const exhaustive: never = criteria;
      void exhaustive;
      return "Resolution criteria are not recognised by this version of the app.";
    }
  }
}

export default async function PredictionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getOptionalAccessToken();
  if (!token) notFound();

  const prediction = await getPrediction(id, token).catch(() => null);
  if (!prediction) notFound();

  const resolved = prediction.status !== "open";

  return (
    <div className="max-w-4xl">
      <Link
        href="/forecast"
        className="mb-6 inline-block text-[13px] text-ink-secondary hover:text-ink"
      >
        Back to predictions
      </Link>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone="neutral">
          {PATTERN_LABEL[prediction.pattern_type] ?? prediction.pattern_type}
        </Badge>
        {prediction.status === "hit" ? <Badge tone="hit">Hit</Badge> : null}
        {prediction.status === "miss" ? <Badge tone="miss">Miss</Badge> : null}
        {prediction.status === "unresolved" ? <Badge tone="unresolved">Unresolved</Badge> : null}
        {prediction.status === "void" ? <Badge tone="neutral">Void</Badge> : null}
        {prediction.status === "open" ? <Badge tone="open">Open</Badge> : null}
      </div>

      <h1 className="mb-6 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        {prediction.statement}
      </h1>

      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        <div className="bg-surface p-5">
          <Metric
            value={`${Math.round(prediction.probability * 100)}%`}
            label={resolved ? "Signal said" : "Likely"}
            size="md"
          />
        </div>
        <div className="bg-surface p-5">
          <Metric value={String(prediction.evidence_count)} label="Signals behind it" size="md" />
        </div>
        <div className="bg-surface p-5">
          <Metric
            value={DATE.format(new Date(prediction.resolves_at))}
            label={resolved ? "Resolved on" : "Resolves"}
            size="sm"
          />
        </div>
        <div className="bg-surface p-5">
          {prediction.brier_score !== null ? (
            <Metric
              value={prediction.brier_score.toFixed(3)}
              label="Brier score"
              size="md"
              tone={prediction.status === "hit" ? "hit" : "miss"}
            />
          ) : (
            <Metric value="—" label="Brier score" size="md" tone="muted" />
          )}
        </div>
      </div>

      {resolved ? (
        <Card className="mb-6">
          <CardHeader title="What actually happened" />
          <CardBody>
            <p className="text-[14px] text-ink">{prediction.resolution_note}</p>
            {prediction.resolution_evidence_urls.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {prediction.resolution_evidence_urls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-[13px] text-accent hover:underline"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {prediction.status === "unresolved" ? (
              <p className="mt-3 text-[13px] text-ink-muted">
                No score was recorded. A window that closed with no evidence either way says
                nothing about whether the forecast was good, so it is excluded from the
                scorecard rather than counted as a miss.
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <Card className="mb-6">
          <CardHeader title="How this gets settled" />
          <CardBody>
            <p className="text-[14px] text-ink">
              {criteriaSummary(prediction.resolution_criteria)}
            </p>
            <p className="mt-2 text-[13px] text-ink-secondary">
              Checked automatically on the resolution date by matching collected evidence — no
              model decides the outcome.
            </p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Evidence"
          description="The signals this prediction was made from, as they were at the time."
        />
        <CardBody>
          {prediction.evidence.length === 0 ? (
            <p className="text-[13px] text-ink-muted">
              The underlying signals are no longer available.
            </p>
          ) : (
            <ul className="space-y-3">
              {prediction.evidence.map((signal) => (
                <li key={signal.id} className="flex gap-3 border-b border-line pb-3 last:border-b-0 last:pb-0">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        SOURCE_COLORS[signal.source as keyof typeof SOURCE_COLORS] ?? "var(--color-ink-muted)",
                    }}
                    aria-label={signal.source}
                  />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-ink">
                      {signal.title ?? "(untitled)"}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-secondary">
                      {signal.raw_text}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-ink-muted">
                      <span>{signal.source}</span>
                      {signal.source_url ? (
                        <a
                          href={signal.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline"
                        >
                          source
                        </a>
                      ) : null}
                      <Num className="text-ink-muted">
                        quality {signal.quality_score.toFixed(2)}
                      </Num>
                    </div>
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
