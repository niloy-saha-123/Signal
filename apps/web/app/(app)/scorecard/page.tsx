// Scorecard — Signal's own forecasting track record.
//
// No competitor in this category publishes one. That is the point of the page,
// and it is also why it must never show a number it has not earned: an empty
// track record renders as "no track record yet", never as a zero.
import { getCalibration, listPredictions } from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { ScorecardClient } from "./scorecard-client";

const EMPTY_CALIBRATION = {
  resolved_count: 0,
  brier: null,
  baseline_brier: 0.25,
  buckets: [],
};

export default async function ScorecardPage() {
  const token = await getOptionalAccessToken();

  if (!token) {
    return (
      <ScorecardClient calibration={EMPTY_CALIBRATION} nextResolution={null} openCount={0} />
    );
  }

  const [calibration, open] = await Promise.all([
    getCalibration({}, token).catch(() => EMPTY_CALIBRATION),
    listPredictions({ status: "open", limit: 200 }, token).catch(() => []),
  ]);

  const soonest = open
    .map((prediction) => prediction.resolves_at)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];

  return (
    <ScorecardClient
      calibration={calibration}
      nextResolution={soonest ?? null}
      openCount={open.length}
    />
  );
}
