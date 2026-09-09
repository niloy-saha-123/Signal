// Circuit breaker state machine (Redis) with event logging (Postgres) for flaky
// external calls. closed -> (5 consecutive failures) -> open -> (60s cooldown) ->
// a single caller claims the half_open trial -> success closes it, failure reopens it
// immediately (no need to accumulate 5 fresh failures again).
import { cacheRedis } from "../lib/redis-client";
import { db } from "../db/client";
import { circuitEventsTable } from "../db/schema";
import { logger } from "../lib/logger";

const FAILURE_THRESHOLD = Number(process.env.CIRCUIT_FAILURE_THRESHOLD ?? 5);
const OPEN_TTL_SECONDS = Number(process.env.CIRCUIT_TIMEOUT_MS ?? 60000) / 1000;
const HALF_OPEN_TRIAL_TTL_SECONDS = 10;

type CircuitState = "closed" | "open" | "half_open";

function stateKey(service: string) {
  return `circuit:${service}:state`;
}
function failuresKey(service: string) {
  return `circuit:${service}:failures`;
}
function halfOpenKey(service: string) {
  return `circuit:${service}:half_open`;
}

export async function getCircuitState(service: string): Promise<CircuitState> {
  const state = await cacheRedis.get(stateKey(service));
  if (state) return state as CircuitState;

  // No open-state key — either the circuit was never tripped, or its TTL just expired.
  // Distinguish those by checking whether the failure counter is still at/above
  // threshold: if so, this is a stale-expiry, and exactly one caller should be let
  // through as a half-open trial rather than everyone flooding back in at once.
  const failures = await cacheRedis.get(failuresKey(service));
  if (!failures || Number(failures) < FAILURE_THRESHOLD) {
    return "closed";
  }

  const claimed = await cacheRedis.set(
    halfOpenKey(service),
    "1",
    "EX",
    HALF_OPEN_TRIAL_TTL_SECONDS,
    "NX"
  );
  return claimed === "OK" ? "half_open" : "open";
}

export async function isCircuitOpen(service: string): Promise<boolean> {
  return (await getCircuitState(service)) === "open";
}

async function logEvent(service: string, state: CircuitState, reason?: string) {
  try {
    await db.insert(circuitEventsTable).values({ service, state, reason: reason ?? null });
  } catch (err) {
    logger.error("Failed to write circuit_events row", { service, state, reason, error: err });
  }
}

export async function recordFailure(service: string, reason: string): Promise<void> {
  const wasHalfOpenTrial = (await cacheRedis.del(halfOpenKey(service))) > 0;

  if (wasHalfOpenTrial) {
    // A failed trial reopens immediately — no need to accumulate fresh failures again.
    await cacheRedis.set(stateKey(service), "open", "EX", OPEN_TTL_SECONDS);
    await logEvent(service, "open", reason);
    return;
  }

  const failures = await cacheRedis.incr(failuresKey(service));
  if (failures >= FAILURE_THRESHOLD) {
    await cacheRedis.set(stateKey(service), "open", "EX", OPEN_TTL_SECONDS);
    await logEvent(service, "open", reason);
  }
}

export async function recordSuccess(service: string): Promise<void> {
  await cacheRedis.del(failuresKey(service));
  await cacheRedis.del(halfOpenKey(service));
  await cacheRedis.set(stateKey(service), "closed");
  await logEvent(service, "closed");
}
