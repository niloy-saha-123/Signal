// Fixed-window counter per key. Coarse at window edges (up to 2x the limit
// across a boundary), which is fine for abuse protection.
import type Redis from "ioredis";

export async function hitFixedWindow(
  redis: Pick<Redis, "multi">,
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now()
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const windowStart = Math.floor(now / 1000 / windowSeconds) * windowSeconds;
  const windowKey = `${key}:${windowStart}`;
  const result = await redis.multi().incr(windowKey).expire(windowKey, windowSeconds).exec();
  const [error, count] = result?.[0] ?? [new Error("rate limit: empty redis reply"), null];
  if (error) throw error;
  const retryAfterSeconds = Math.max(1, windowStart + windowSeconds - Math.floor(now / 1000));
  return { allowed: Number(count) <= limit, retryAfterSeconds };
}
