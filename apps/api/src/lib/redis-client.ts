// Single shared ioredis connection. Every module that needs Redis (caching, circuit
// breaker state, BullMQ) imports `redis` from here rather than opening its own connection.
import Redis from "ioredis";
import { logger } from "./logger";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// Reserved for BullMQ's own use — maxRetriesPerRequest: null is required so BullMQ's
// blocking commands don't time out, but that also means any command on this connection
// hangs indefinitely on a Redis outage. Non-BullMQ callers should use `cacheRedis` below.
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});
redis.on("error", (err) => logger.error("Redis client error", { error: err }));

// App-level cache/circuit-breaker connection — bounded retries so a Redis outage fails
// fast instead of hanging the caller indefinitely.
export const cacheRedis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 2,
  connectTimeout: 2_000,
  commandTimeout: 2_000,
  enableOfflineQueue: false,
});
cacheRedis.on("error", (err) => logger.error("Redis client error", { error: err }));

export interface RedisReadinessProbeOptions {
  timeoutMs: number;
  signal: AbortSignal;
}

// The probe owns its connection. Timeout/abort always disconnects it, so a
// dead Redis socket or queued command cannot outlive the readiness request.
export async function checkRedisReadiness({
  timeoutMs,
  signal,
}: RedisReadinessProbeOptions): Promise<void> {
  signal.throwIfAborted();
  const probe = cacheRedis.duplicate({
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
  });
  // The route emits one sanitized readiness warning. Prevent ioredis from
  // printing its raw unhandled-error fallback (which may include host details).
  probe.on("error", () => {});
  const onAbort = () => probe.disconnect();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await probe.connect();
    await probe.ping();
  } finally {
    signal.removeEventListener("abort", onAbort);
    probe.disconnect();
  }
}

export async function closeRedisConnections(): Promise<void> {
  const clients = [redis, cacheRedis];
  try {
    await Promise.race([
      Promise.allSettled(clients.map((client) => client.quit())),
      new Promise<void>((resolve) => {
        const handle = setTimeout(resolve, 5_000);
        handle.unref();
      }),
    ]);
  } finally {
    // `disconnect` is idempotent and guarantees a blocking BullMQ connection
    // cannot hold the process open if Redis vanished during shutdown.
    for (const client of clients) client.disconnect();
  }
}
