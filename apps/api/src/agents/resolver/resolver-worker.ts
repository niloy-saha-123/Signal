// BullMQ worker — settles every prediction that has come due, once a day.
//
// This is the sweep that makes the ledger mean something. Without it, every
// prediction Signal makes stays open forever and the product is exactly the
// thing it was built to replace: confident forward-looking claims nobody ever
// revisits.
//
// Scheduled an hour after the daily analysis sweep so the day's collection and
// scoring have already landed — a prediction resolved against a half-collected
// day would be judged on evidence that exists but had not been fetched yet.
import type { Job } from "bullmq";
import { isCircuitOpen, recordFailure, recordSuccess } from "../../reliability/circuit-breaker";
import { logger } from "../../lib/logger";
import { registerWorker } from "../../queues/registry";
import { listDuePredictions, resolvePrediction, getCompetitorById } from "../../db/queries";
import { deliverResolutionToSlack } from "../../integrations/slack/delivery";
import { resolvePredictionCriteria } from "./prediction-resolver";
import { brierScore } from "../../lib/calibration";

const SERVICE_NAME = "prediction-resolver";

// One prediction must not be able to hold the whole sweep. The queries inside
// resolvePredictionCriteria are row-capped but have no statement timeout, so a
// single query stuck behind lock contention would otherwise block every other
// workspace's resolutions until the next day's tick.
const PER_PREDICTION_TIMEOUT_MS = 30_000;

async function withDeadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${PER_PREDICTION_TIMEOUT_MS}ms`)),
          PER_PREDICTION_TIMEOUT_MS
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface PredictionResolverJobData {
  // No fields — every run sweeps every workspace's due predictions.
}

async function recordCircuitFailure(err: unknown): Promise<void> {
  try {
    await recordFailure(SERVICE_NAME, err instanceof Error ? err.message : String(err));
  } catch (recordErr) {
    // recordFailure makes unguarded Redis calls that can themselves throw —
    // never let that mask the real error.
    logger.error("Failed to record circuit-breaker failure for the prediction resolver", {
      error: recordErr,
    });
  }
}

export async function predictionResolverProcessor(
  _job: Job<PredictionResolverJobData>
): Promise<void> {
  if (await isCircuitOpen(SERVICE_NAME)) {
    throw new Error(`${SERVICE_NAME} circuit is open — skipping job`);
  }

  const now = new Date();

  try {
    const due = await listDuePredictions(now);

    let hadFailure = false;

    for (const prediction of due) {
      // One prediction failing to resolve must not cost the rest of the sweep —
      // the ledger's value is that it settles everything that came due, and a
      // single malformed row should not freeze the whole track record.
      try {
        const outcome = await withDeadline(
          resolvePredictionCriteria(prediction, now),
          `resolving prediction ${prediction.id}`
        );

        // Only a real verdict carries a score. An unresolved window says nothing
        // about accuracy, so it stores null rather than a number that would later
        // be averaged into the workspace's Brier score.
        const brier =
          outcome.status === "unresolved"
            ? null
            : brierScore(prediction.probability, outcome.status === "hit");

        const settled = await resolvePrediction({
          id: prediction.id,
          status: outcome.status,
          resolved_at: now,
          resolution_note: outcome.note,
          resolution_evidence_urls: outcome.evidence_urls,
          brier_score: brier,
        });

        // Another path already settled this one. The row write was a correct
        // no-op; announcing anyway would put a second "prediction resolved"
        // message in the channel for the same prediction.
        if (!settled) {
          logger.info("prediction was already resolved by another run — not announcing again", {
            prediction_id: prediction.id,
          });
          continue;
        }

        // Announcing misses as plainly as hits is the point. A ledger that only
        // broadcasts its wins is marketing wearing a track record's clothes.
        await deliverResolutionToSlack(prediction.workspace_id, {
          statement: prediction.statement,
          competitor_name:
            (await getCompetitorById(prediction.competitor_id))?.name ?? "A competitor",
          probability: prediction.probability,
          status: outcome.status,
          resolution_note: outcome.note,
          resolution_evidence_urls: outcome.evidence_urls,
          brier_score: brier,
        });

        logger.info("prediction resolved", {
          prediction_id: prediction.id,
          competitor_id: prediction.competitor_id,
          status: outcome.status,
          probability: prediction.probability,
          brier_score: brier,
        });
      } catch (err) {
        hadFailure = true;
        logger.error("prediction resolver failed for one prediction — continuing with the rest", {
          prediction_id: prediction.id,
          competitor_id: prediction.competitor_id,
          error: err instanceof Error ? err.message : String(err),
        });
        await recordCircuitFailure(err);
      }
    }

    if (!hadFailure) {
      await recordSuccess(SERVICE_NAME);
    }
  } catch (err) {
    // Failure outside the per-prediction loop (listDuePredictions itself) — a
    // real job-level failure, so this one rethrows.
    await recordCircuitFailure(err);
    throw err;
  }
}

// Extension point — only called from the standalone worker entrypoint, so
// importing this module never starts a live Worker as a side effect.
export function initPredictionResolverWorker() {
  return registerWorker("resolve-predictions", predictionResolverProcessor);
}
