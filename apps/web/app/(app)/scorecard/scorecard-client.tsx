"use client";

import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Metric,
  Num,
  PageHeader,
} from "@/components/ui/primitives";
import type { Calibration } from "@/lib/api";

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

// A reliability diagram, drawn as rows rather than a scatter plot. At the
// volumes a real workspace will have for months — tens of predictions, not
// thousands — a chart would be mostly empty space pretending to be rigorous.
// Rows show the same thing honestly: what Signal said, what actually happened,
// and how many calls each bucket rests on.
function CalibrationRows({ calibration }: { calibration: Calibration }) {
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-line pb-2 text-[11px] font-semibold text-ink-muted">
        <span>Stated confidence</span>
        <span className="text-right">Said</span>
        <span className="text-right">Actual</span>
        <span className="text-right">Calls</span>
      </div>
      <ul>
        {calibration.buckets.map((bucket) => {
          const gap = bucket.observed - bucket.predicted;
          return (
            <li
              key={bucket.range}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 border-b border-line py-3 last:border-b-0"
            >
              <div>
                <div className="mb-1.5 text-[13px] text-ink">{bucket.range}</div>
                {/* Two stacked bars: what was claimed, and what happened. A
                    well-calibrated bucket has them the same length, which is
                    readable at a glance without decoding a scatter plot. */}
                <div className="space-y-1">
                  <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-ink-muted"
                      style={{ width: `${Math.max(2, bucket.predicted * 100)}%` }}
                    />
                  </div>
                  <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.max(2, bucket.observed * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
              <Num className="text-right text-ink-secondary">
                {Math.round(bucket.predicted * 100)}%
              </Num>
              <Num className="text-right text-ink">{Math.round(bucket.observed * 100)}%</Num>
              <Num className="text-right text-ink-muted">{bucket.count}</Num>
              <div className="col-span-4 mt-1 text-[12px] text-ink-muted">
                {Math.abs(gap) < 0.05
                  ? "Well calibrated in this range."
                  : gap < 0
                    ? `Overconfident here by ${Math.round(Math.abs(gap) * 100)} points.`
                    : `Underconfident here by ${Math.round(gap * 100)} points.`}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex gap-4 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-4 rounded-full bg-ink-muted" /> What Signal said
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-4 rounded-full bg-accent" /> What happened
        </span>
      </div>
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
        description="Signal grades itself. Every resolved prediction is scored by how confident it was and whether it was right, then averaged — so overclaiming costs it when it is wrong, and hedging costs it when it is right."
      />

      {/* This empty state is the most important one in the product. A workspace
          with nothing resolved must never see a number here: zero is a perfect
          Brier score, and rendering "no track record" as perfection is exactly
          the dishonesty the ledger exists to remove. */}
      {!scored ? (
        <EmptyState
          title="No track record yet"
          note={
            nextResolution
              ? `Nothing has resolved, so there is no score to show. ${openCount} prediction${openCount === 1 ? "" : "s"} are open and the first one is checked on ${DATE.format(new Date(nextResolution))}.`
              : "Nothing has resolved, so there is no score to show. Signal only forecasts above an evidence floor, so this fills in as competitors accumulate collected signal — not on a schedule."
          }
        />
      ) : (
        <>
          <div className="mb-8 grid gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-3">
            <div className="bg-surface p-6">
              <Metric value={calibration.brier!.toFixed(3)} label="Brier score" />
              <p className="mt-2 text-[12px] text-ink-muted">Lower is better. 0 is perfect.</p>
            </div>
            <div className="bg-surface p-6">
              <Metric
                value={calibration.baseline_brier.toFixed(2)}
                label="Coin-flip baseline"
                tone="muted"
              />
              <p className="mt-2 text-[12px] text-ink-muted">
                What you score by saying &ldquo;maybe&rdquo; to everything.
              </p>
            </div>
            <div className="bg-surface p-6">
              <Metric value={String(calibration.resolved_count)} label="Scored predictions" />
              <p className="mt-2 text-[12px] text-ink-muted">
                Unresolved and voided predictions are excluded.
              </p>
            </div>
          </div>

          <Card className="mb-8">
            <CardBody>
              <p className="text-[14px] text-ink">
                {beatsBaseline ? (
                  <>
                    Signal is beating the coin-flip baseline by{" "}
                    <Num className="font-medium text-ink">
                      {(calibration.baseline_brier - calibration.brier!).toFixed(3)}
                    </Num>
                    .
                  </>
                ) : (
                  <>
                    Signal is <span className="font-medium">not</span> currently beating the
                    coin-flip baseline. On this record you would do as well assuming every
                    prediction is a 50/50.
                  </>
                )}
              </p>
              <p className="mt-2 text-[13px] text-ink-secondary">
                {calibration.resolved_count < 10
                  ? `Read this cautiously — ${calibration.resolved_count} resolved prediction${calibration.resolved_count === 1 ? "" : "s"} is not enough to tell skill from luck.`
                  : "Enough predictions have resolved for this to carry some weight, though the sample is still small."}
              </p>
            </CardBody>
          </Card>

          {calibration.buckets.length > 0 ? (
            <Card>
              <CardHeader
                title="Calibration by confidence"
                description="If Signal is well calibrated, the things it called 70% likely happened about 70% of the time."
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
