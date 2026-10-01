// Shared sweep loop for scheduled collectors: one circuit per source,
// per-competitor isolation, and a mid-run circuit re-check. Moved out of
// changelog.ts so the v5 collectors don't each carry their own copy.
import {
  isCircuitOpen,
  recordFailure,
  recordSuccess,
} from "../reliability/circuit-breaker";
import { logger } from "../lib/logger";
import { listCompetitors, type Competitor } from "../db/queries";

async function recordCircuitFailure(
  service: string,
  err: unknown,
): Promise<void> {
  try {
    await recordFailure(
      service,
      err instanceof Error ? err.message : String(err),
    );
  } catch (recordErr) {
    // recordFailure makes unguarded Redis calls that can themselves throw —
    // never let that mask the real error.
    logger.error(`Failed to record circuit-breaker failure for ${service}`, {
      error: recordErr,
    });
  }
}

export async function runSourceSweep<T>(
  service: string,
  configOf: (competitor: Competitor) => T | null,
  collectOne: (competitor: Competitor, config: T) => Promise<void>,
): Promise<void> {
  if (await isCircuitOpen(service)) {
    throw new Error(`${service} circuit is open — skipping job`);
  }

  try {
    const targets = (await listCompetitors()).flatMap((competitor) => {
      if (!competitor.is_active) return [];
      const config = configOf(competitor);
      return config === null || config === undefined
        ? []
        : [{ competitor, config }];
    });

    let hadFailure = false;
    // Exiting on a mid-run trip is not a clean run, so it must not let the
    // trailing recordSuccess() force-close a circuit just observed open.
    let circuitTrippedMidRun = false;
    for (const { competitor, config } of targets) {
      if (await isCircuitOpen(service)) {
        circuitTrippedMidRun = true;
        logger.warn(
          `${service} circuit opened mid-run — stopping before remaining competitors`,
          {
            competitor_id: competitor.id,
            competitor_name: competitor.name,
          },
        );
        break;
      }

      try {
        await collectOne(competitor, config);
      } catch (err) {
        hadFailure = true;
        logger.error(
          `${service} collector failed for one competitor — continuing with the rest`,
          {
            competitor_id: competitor.id,
            competitor_name: competitor.name,
            error: err instanceof Error ? err.message : String(err),
          },
        );
        await recordCircuitFailure(service, err);
      }
    }

    if (!hadFailure && !circuitTrippedMidRun) {
      await recordSuccess(service);
    }
  } catch (err) {
    // Failure outside the per-competitor loop (e.g. listCompetitors) is a
    // job-level failure, so it rethrows.
    await recordCircuitFailure(service, err);
    throw err;
  }
}
