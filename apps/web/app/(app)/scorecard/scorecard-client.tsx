"use client";

import { ForecastAreaTabs } from "@/components/forecast/parts";
import { Card, CardBody, CardHeader, EmptyState, Metric, Num, PageHeader, LinkButton } from "@/components/ui/primitives";
import type { Calibration } from "@/lib/api";
import { formatDate } from "@/lib/format";

// A reliability diagram drawn as rows. At the volumes a real workspace has for
// months — tens of forecasts, not thousands — a scatter plot would be mostly
// empty space pretending to be rigorous.
function CalibrationRows({ calibration }: { calibration: Calibration }) {
  return (
    <div>
      <ul className="divide-y divide-line">
        {calibration.buckets.map((bucket) => {
          const gap = bucket.observed - bucket.predicted;
          return (
            <li key={bucket.range} className="grid grid-cols-[1fr_auto] items-center gap-x-6 py-4">
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-semibold text-ink">Said {bucket.range}</span>
                  <span className="text-[13px] text-ink-muted">
                    {Math.abs(gap) < 0.05
                      ? "Well calibrated"
                      : gap < 0
                        ? `Overconfident by ${Math.round(Math.abs(gap) * 100)} pts`
                        : `Underconfident by ${Math.round(gap * 100)} pts`}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <Bar value={bucket.predicted} className="bg-ink-muted" label="What Signal said" />
                  <Bar value={bucket.observed} className="bg-ink" label="What happened" />
                </div>
              </div>
              <div className="text-right">
                <Num className="block text-[15px] font-semibold text-ink">{Math.round(bucket.observed * 100)}%</Num>
                <span className="text-[12px] text-ink-muted">
                  of {bucket.count} call{bucket.count === 1 ? "" : "s"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex gap-5 text-[12.5px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-5 rounded-full bg-ink-muted" /> What Signal said
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-5 rounded-full bg-ink" /> What happened
        </span>
      </div>
    </div>
  );
}

function Bar({ value, className, label }: { value: number; className: string; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken" role="img" aria-label={`${label}: ${pct}%`}>
      <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

export function ScorecardClient({
  calibration,
  nextResolution,
  openCount,
}: {
  calibration: Calibration;
  nextResolution: string | null;
  openCount: number;
}) {
  const scored = calibration.resolved_count > 0 && calibration.brier !== null;
  const beatsBaseline = scored && calibration.brier! < calibration.baseline_brier;

  return (
    <div>
      <PageHeader
        title="Scorecard"
        description="Signal grades itself. Each settled forecast is scored on how confident it was and whether it was right, so overclaiming costs it when wrong and hedging costs it when right."
        action={<ForecastAreaTabs active="scorecard" />}
      />

      {/* The most important empty state in the product. Nothing resolved must
          never show a number: zero is a perfect Brier score. */}
      {!scored ? (
        <EmptyState
          title="No track record yet"
          note={
            nextResolution
              ? `Nothing has settled, so there's no score to show. ${openCount} forecast${openCount === 1 ? " is" : "s are"} open and the first one is checked ${formatDate(nextResolution)}.`
              : "Nothing has settled, so there's no score to show. Signal only forecasts above an evidence bar, so this fills in as evidence accumulates, not on a schedule."
          }
          action={
            <LinkButton href="/forecast" size="sm">
              See open forecasts
            </LinkButton>
          }
        />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[14px] bg-sky p-6">
              <Metric value={calibration.brier!.toFixed(3)} label="Brier score. Lower is better; 0 is perfect." size="md" />
            </div>
            <div className="rounded-[14px] bg-sky p-6">
              <Metric
                value={calibration.baseline_brier.toFixed(2)}
                label="Coin-flip baseline: answering “maybe” to everything"
                size="md"
                tone="muted"
              />
            </div>
            <div className="rounded-[14px] bg-sky p-6">
              <Metric value={String(calibration.resolved_count)} label="Scored forecasts (unresolved and void excluded)" size="md" />
            </div>
          </div>

          <Card className="mb-6">
            <CardBody>
              <p className="text-[16px] text-ink">
                {beatsBaseline ? (
                  <>
                    Signal is beating the coin-flip baseline by{" "}
                    <Num className="font-semibold">{(calibration.baseline_brier - calibration.brier!).toFixed(3)}</Num>.
                  </>
                ) : (
                  <>
                    Signal is <span className="font-semibold">not</span> beating the coin-flip baseline yet. On this
                    record you&rsquo;d do as well treating every forecast as 50/50.
                  </>
                )}
              </p>
              <p className="mt-2 text-[14px] text-ink-secondary">
                {calibration.resolved_count < 10
                  ? `Read this cautiously: ${calibration.resolved_count} settled forecast${calibration.resolved_count === 1 ? " is" : "s are"} not enough to tell skill from luck.`
                  : "Enough forecasts have settled for this to carry some weight, though the sample is still small."}
              </p>
            </CardBody>
          </Card>

          {calibration.buckets.length > 0 ? (
            <Card>
              <CardHeader
                title="Calibration by confidence"
                description="If Signal is well calibrated, things it called 70% likely happened about 70% of the time."
              />
              <CardBody>
                <CalibrationRows calibration={calibration} />
              </CardBody>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
