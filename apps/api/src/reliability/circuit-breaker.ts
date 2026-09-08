// Circuit breaker state machine (Redis) with event logging (Postgres) for flaky
// external calls. closed -> (5 consecutive failures) -> open -> (60s cooldown, handled
// by caller re-checking) -> half_open -> success closes it, failure reopens it.
import { redis } from "../lib/redis-client";
import { db } from "../db/client";
import { circuitEventsTable } from "../db/schema";

const FAILURE_THRESHOLD = 5;
const OPEN_TTL_SECONDS = 60;

type CircuitState = "closed" | "open" | "half_open";

function stateKey(service: string) {
  return `circuit:${service}:state`;
}
function failuresKey(service: string) {
  return `circuit:${service}:failures`;
}

export async function getCircuitState(service: string): Promise<CircuitState> {
  const state = await redis.get(stateKey(service));
  return (state as CircuitState) ?? "closed";
}

export async function isCircuitOpen(service: string): Promise<boolean> {
  return (await getCircuitState(service)) === "open";
}

async function logEvent(service: string, state: CircuitState, reason?: string) {
  await db.insert(circuitEventsTable).values({ service, state, reason: reason ?? null });
}

export async function recordFailure(service: string, reason: string): Promise<void> {
  const failures = await redis.incr(failuresKey(service));
  if (failures >= FAILURE_THRESHOLD) {
    await redis.set(stateKey(service), "open", "EX", OPEN_TTL_SECONDS);
    await logEvent(service, "open", reason);
  }
}

export async function recordSuccess(service: string): Promise<void> {
  await redis.del(failuresKey(service));
  await redis.set(stateKey(service), "closed");
  await logEvent(service, "closed");
}
