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
});
cacheRedis.on("error", (err) => logger.error("Redis client error", { error: err }));
