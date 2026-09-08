// Single shared ioredis connection. Every module that needs Redis (caching, circuit
// breaker state, BullMQ) imports `redis` from here rather than opening its own connection.
import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null, // required by BullMQ workers sharing this connection
});
