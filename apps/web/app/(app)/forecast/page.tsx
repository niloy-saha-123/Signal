// Forecast — the prediction ledger. Open predictions ordered by what resolves
// soonest, plus everything already settled.
//
// An unauthenticated visitor gets the empty shell rather than preview data:
// fabricating a track record is the one thing this product cannot do, even in a
// dev preview, because the whole claim is that what you see here actually
// happened.
import { getCalibration, listCompetitors, listPredictions } from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { ForecastClient } from "./forecast-client";

export default async function ForecastPage() {
  const token = await getOptionalAccessToken();

  const emptyCalibration = {
    resolved_count: 0,
    brier: null,
    baseline_brier: 0.25,
    buckets: [],
  };

  if (!token) {
    return (
      <ForecastClient predictions={[]} calibration={emptyCalibration} competitors={[]} />
    );
  }

  const [predictions, calibration, competitors] = await Promise.all([
    listPredictions({ limit: 200 }, token),
    getCalibration({}, token).catch(() => emptyCalibration),
    listCompetitors(token).catch(() => []),
  ]);

  return (
    <ForecastClient
      predictions={predictions}
      calibration={calibration}
      competitors={competitors.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
